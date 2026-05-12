import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { buildCargosHttpAdapterBody, CargosEnqueueBody } from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/types';
import {
  assertAgentReservationInScope,
  assertSameCompany,
  effectiveListCompanyFilter,
  isAdmin,
  isAgentStationScoped,
} from '../../auth/company-access';
import { isPastCargosEnqueueCutoff } from '../../reservation/reservation-handover.util';

type CompanyAdapterRow = {
  id: string;
  cargosInScope: boolean;
  cargosAdapter: 'MOCK' | 'HTTP' | 'OFF';
  cargosHttpUrl: string | null;
  cargosEnvironment: 'TEST' | 'PRODUCTION';
};

function parseNonNegMs(s: string | undefined, def: number): number {
  if (!s) {
    return def;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function parsePosInt(s: string | undefined, def: number): number {
  if (!s) {
    return def;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : def;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

@Injectable()
export class CargosService {
  private readonly logger = new Logger(CargosService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(data: CargosEnqueueBody, user: JwtUser) {
    const r = await this.prisma.reservation.findUnique({ where: { id: data.reservationId } });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${data.reservationId}`);
    }
    assertSameCompany(user, r.companyId, `Reservation not found: ${data.reservationId}`);
    assertAgentReservationInScope(
      user,
      r.pickupStationId,
      r.returnStationId,
      `Reservation not found: ${data.reservationId}`,
    );
    if (r.status === 'CANCELLED') {
      throw new BadRequestException('Will not queue CaRGOS for a cancelled reservation');
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: r.companyId } });
    if (!company.cargosInScope) {
      return this.prisma.cargosSubmission.create({
        data: {
          companyId: r.companyId,
          reservationId: r.id,
          status: 'SKIPPED',
          processedAt: new Date(),
          errorMessage: 'Company: CaRGOS not in scope (D5)',
        },
      });
    }
    if (company.cargosAdapter === 'OFF') {
      return this.prisma.cargosSubmission.create({
        data: {
          companyId: r.companyId,
          reservationId: r.id,
          status: 'SKIPPED',
          processedAt: new Date(),
          errorMessage: 'Company: CaRGOS adapter OFF (D5)',
        },
      });
    }
    if (company.cargosAdapter === 'HTTP' && !company.cargosHttpUrl?.trim()) {
      throw new BadRequestException(
        'Set company cargosHttpUrl in Organization → CaRGOS, or use MOCK / OFF adapter',
      );
    }
    const inflight = await this.prisma.cargosSubmission.findFirst({
      where: {
        reservationId: r.id,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    let row = inflight;
    if (!row) {
      if (isPastCargosEnqueueCutoff(r.pickupAt, company.cargosCutoffMinutesBeforePickup)) {
        throw new BadRequestException(
          'CaRGOS: cannot enqueue after the cutoff before pickup (company policy). Reschedule pickup or ask Branch/Admin for a handover override.',
        );
      }
      row = await this.prisma.cargosSubmission.create({
        data: {
          companyId: r.companyId,
          reservationId: r.id,
          status: 'PENDING',
        },
      });
    }
    if (data.sendImmediately && row.status === 'PENDING') {
      return this.transmitPendingSubmission(row.id, user);
    }
    return row;
  }

  /**
   * Picks one **PENDING** row, sets **PROCESSING**, runs MOCK/HTTP like the worker, then **MOCK_SENT** or **FAILED** / requeue.
   */
  private async transmitPendingSubmission(submissionId: string, user: JwtUser) {
    const pending = await this.prisma.cargosSubmission.findUnique({ where: { id: submissionId } });
    if (!pending) {
      throw new NotFoundException(`CaRGOS submission not found: ${submissionId}`);
    }
    const resv = await this.prisma.reservation.findUnique({ where: { id: pending.reservationId } });
    if (!resv) {
      throw new NotFoundException(`Reservation not found: ${pending.reservationId}`);
    }
    assertSameCompany(user, resv.companyId, `Reservation not found: ${pending.reservationId}`);
    assertAgentReservationInScope(
      user,
      resv.pickupStationId,
      resv.returnStationId,
      `Reservation not found: ${pending.reservationId}`,
    );
    const lock = await this.prisma.cargosSubmission.updateMany({
      where: { id: pending.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (lock.count === 0) {
      return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    }

    const maxAttempts = parsePosInt(process.env.CARGOS_MAX_ATTEMPTS, 5);
    const company = (await this.prisma.company.findUnique({
      where: { id: pending.companyId },
    })) as CompanyAdapterRow | null;
    if (!company) {
      await this.prisma.cargosSubmission.update({
        where: { id: pending.id },
        data: { status: 'FAILED', errorMessage: 'Company not found', processedAt: new Date() },
      });
      this.logFailed(pending.id, pending.reservationId, 'Company not found');
      return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    }
    if (!company.cargosInScope || company.cargosAdapter === 'OFF') {
      const msg = !company.cargosInScope ? 'In scope: false (D5)' : 'Adapter OFF (D5)';
      await this.prisma.cargosSubmission.update({
        where: { id: pending.id },
        data: { status: 'SKIPPED', processedAt: new Date(), errorMessage: msg },
      });
      return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    }

    try {
      if (company.cargosAdapter === 'MOCK') {
        await sleepMs(parseNonNegMs(process.env.CARGOS_SEND_NOW_MOCK_DELAY_MS, 0));
        await this.prisma.cargosSubmission.update({
          where: { id: pending.id },
          data: { status: 'MOCK_SENT', processedAt: new Date(), errorMessage: null },
        });
        return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
      }
      if (company.cargosAdapter === 'HTTP') {
        const url = company.cargosHttpUrl?.trim();
        if (!url) {
          await this.failOrRequeue(
            pending.id,
            pending.reservationId,
            pending.attemptCount,
            maxAttempts,
            'cargosHttpUrl not set for HTTP',
          );
          return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
        }
        const resRow = await this.loadReservationForCargosHttp(pending.reservationId);
        if (!resRow) {
          await this.prisma.cargosSubmission.update({
            where: { id: pending.id },
            data: { status: 'FAILED', errorMessage: 'Reservation not found', processedAt: new Date() },
          });
          this.logFailed(pending.id, pending.reservationId, 'Reservation not found');
          return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
        }
        const timeout = parseNonNegMs(process.env.CARGOS_HTTP_TIMEOUT_MS, 30_000);
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeout);
        const body = buildCargosHttpAdapterBody(pending, resRow, company.cargosEnvironment);
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cargos-Environment': company.cargosEnvironment,
          },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        clearTimeout(t);
        if (resp.ok) {
          await this.prisma.cargosSubmission.update({
            where: { id: pending.id },
            data: { status: 'MOCK_SENT', processedAt: new Date(), errorMessage: null },
          });
        } else {
          const ttxt = await resp.text().catch(() => '');
          await this.failOrRequeue(
            pending.id,
            pending.reservationId,
            pending.attemptCount,
            maxAttempts,
            `HTTP ${resp.status} ${ttxt?.slice(0, 500)}`,
          );
        }
        return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
      }
      await this.prisma.cargosSubmission.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          errorMessage: `Unknown adapter: ${company.cargosAdapter}`,
          processedAt: new Date(),
        },
      });
      this.logFailed(pending.id, pending.reservationId, `Unknown adapter: ${company.cargosAdapter}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.failOrRequeue(
        pending.id,
        pending.reservationId,
        pending.attemptCount,
        maxAttempts,
        msg,
      );
    }
    return this.prisma.cargosSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  }

  private async loadReservationForCargosHttp(reservationId: string) {
    return this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        company: { select: { name: true } },
        pickupStation: { select: { name: true, code: true, cargosLocationCode: true } },
        vehicle: {
          select: {
            id: true,
            licensePlate: true,
            modelLabel: true,
            vin: true,
            vehicleType: true,
            vehicleClass: { select: { code: true, name: true } },
          },
        },
        customer: {
          select: { id: true, name: true, email: true, fiscalCode: true, vatNumber: true },
        },
        rentalAgreement: {
          select: { id: true, status: true, agreementTemplateVersion: true, signedAt: true },
        },
      },
    });
  }

  private logFailed(submissionId: string, reservationId: string, errorMessage: string): void {
    const err = errorMessage.replace(/\s+/g, ' ').trim().slice(0, 500);
    this.logger.warn(
      `[cargos] FAILED submissionId=${submissionId} reservationId=${reservationId} error=${JSON.stringify(err)}`,
    );
  }

  private async failOrRequeue(
    id: string,
    reservationId: string,
    attemptCount: number,
    maxAttempts: number,
    errMsg: string,
  ): Promise<void> {
    const next = attemptCount + 1;
    if (next >= maxAttempts) {
      const msg = errMsg.slice(0, 2000);
      await this.prisma.cargosSubmission.update({
        where: { id },
        data: { status: 'FAILED', errorMessage: msg, processedAt: new Date(), attemptCount: next },
      });
      this.logFailed(id, reservationId, msg);
    } else {
      await this.prisma.cargosSubmission.update({
        where: { id },
        data: { status: 'PENDING', errorMessage: errMsg.slice(0, 2000), attemptCount: next },
      });
    }
  }

  async listSubmissions(
    user: JwtUser,
    q: { companyId?: string; reservationId?: string },
  ) {
    if (q.reservationId) {
      const r = await this.prisma.reservation.findUnique({ where: { id: q.reservationId } });
      if (!r) {
        throw new NotFoundException(`Reservation not found: ${q.reservationId}`);
      }
      assertSameCompany(user, r.companyId, `Reservation not found: ${q.reservationId}`);
      assertAgentReservationInScope(
        user,
        r.pickupStationId,
        r.returnStationId,
        `Reservation not found: ${q.reservationId}`,
      );
    }
    if (isAdmin(user) && !q.companyId && !q.reservationId) {
      throw new BadRequestException('Provide companyId and/or reservationId for CaRGOS submission list');
    }
    const companyF = effectiveListCompanyFilter(user, q.companyId);
    const where: {
      companyId?: string;
      reservationId?: string;
      reservation?: {
        OR: Array<{ pickupStationId: string } | { returnStationId: string }>;
      };
    } = {
      ...companyF,
      ...(q.reservationId ? { reservationId: q.reservationId } : {}),
    };
    if (isAgentStationScoped(user) && !q.reservationId) {
      const sid = user.stationId!;
      where.reservation = {
        OR: [{ pickupStationId: sid }, { returnStationId: sid }],
      };
    }
    return this.prisma.cargosSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
