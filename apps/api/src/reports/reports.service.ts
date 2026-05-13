import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CompanyReportQuery,
  COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY,
  type CustomerDocumentsOcrPendingQuery,
} from '@car-rental/shared';
import { JwtUser } from '../auth/types';
import { isAdminCrossCompany, effectiveListCompanyFilter } from '../auth/company-access';
import { PrismaService } from '../prisma/prisma.service';

function utcDayBounds(from: string, to: string) {
  const fromD = new Date(`${from}T00:00:00.000Z`);
  const toD = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    throw new BadRequestException('Invalid date');
  }
  return { from: fromD, to: toD };
}

/** Inclusive `from` / `to` as `YYYY-MM-DD` → half-open [start, endExclusive) in UTC (aligns with reservation intervals). */
function utcRangeHalfOpenDays(fromYmd: string, toYmd: string) {
  const start = new Date(`${fromYmd}T00:00:00.000Z`);
  const endDay = new Date(`${toYmd}T00:00:00.000Z`);
  const endExclusive = new Date(endDay);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) || endExclusive <= start) {
    throw new BadRequestException('Invalid date');
  }
  return { start, endExclusive };
}

function overlapMsHalfOpen(
  pickup: Date,
  returnAt: Date,
  rangeStart: Date,
  rangeEndExcl: Date,
): number {
  const a = Math.max(pickup.getTime(), rangeStart.getTime());
  const b = Math.min(returnAt.getTime(), rangeEndExcl.getTime());
  return a < b ? b - a : 0;
}

/** Every UTC calendar day from `fromYmd` through `toYmd` inclusive (YYYY-MM-DD). */
function eachUtcDayInclusive(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${fromYmd}T00:00:00.000Z`);
  const end = new Date(`${toYmd}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) {
    return out;
  }
  for (;;) {
    out.push(cur.toISOString().slice(0, 10));
    if (cur.getTime() >= end.getTime()) break;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const CARGOS_DAILY_STATUS_ORDER = [
  'PENDING',
  'PROCESSING',
  'MOCK_SENT',
  'FAILED',
  'SKIPPED',
] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCompanyReport(q: CompanyReportQuery, user: JwtUser) {
    if (!isAdminCrossCompany(user)) {
      if (q.companyId !== user.companyId) {
        throw new ForbiddenException('Not allowed to access this company');
      }
    }
    const { from, to } = utcDayBounds(q.from, q.to);
    const companyWhere: Prisma.CompanyWhereInput = { id: q.companyId };
    const co = await this.prisma.company.findFirst({ where: companyWhere, select: { id: true, name: true } });
    if (!co) {
      throw new BadRequestException('Company not found');
    }

    const f = effectiveListCompanyFilter(user, q.companyId);
    const resWhere: Prisma.ReservationWhereInput = { ...(Object.keys(f).length ? f : { companyId: q.companyId }) };
    if (user.role === 'AGENT' && user.stationId) {
      resWhere.OR = [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }];
    }

    const { start: rangeStart, endExclusive: rangeEndExcl } = utcRangeHalfOpenDays(q.from, q.to);
    const rangeMs = rangeEndExcl.getTime() - rangeStart.getTime();
    const calendarDaysInRange = rangeMs / 86_400_000;

    const vehicleWhere: Prisma.VehicleWhereInput = {
      companyId: q.companyId,
      status: { not: 'OUT_OF_FLEET' },
    };
    if (user.role === 'AGENT' && user.stationId) {
      vehicleWhere.homeStationId = user.stationId;
    }

    const cargosWhere: Prisma.CargosSubmissionWhereInput = {
      companyId: q.companyId,
      createdAt: { gte: from, lte: to },
    };
    if (user.role === 'AGENT' && user.stationId) {
      cargosWhere.reservation = {
        OR: [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }],
      };
    }

    const cargosDailySql = async () => {
      if (user.role === 'AGENT' && user.stationId) {
        return this.prisma.$queryRaw<Array<{ day: Date; status: string; cnt: bigint }>>`
          SELECT (cs."createdAt" AT TIME ZONE 'UTC')::date AS day,
                 cs.status::text AS status,
                 COUNT(*)::bigint AS cnt
          FROM "CargosSubmission" cs
          INNER JOIN "Reservation" r ON r.id = cs."reservationId"
          WHERE cs."companyId" = ${q.companyId}::uuid
            AND cs."createdAt" >= ${from}
            AND cs."createdAt" <= ${to}
            AND (r."pickupStationId" = ${user.stationId} OR r."returnStationId" = ${user.stationId})
          GROUP BY 1, cs.status
          ORDER BY 1 ASC
        `;
      }
      return this.prisma.$queryRaw<Array<{ day: Date; status: string; cnt: bigint }>>`
        SELECT (cs."createdAt" AT TIME ZONE 'UTC')::date AS day,
               cs.status::text AS status,
               COUNT(*)::bigint AS cnt
        FROM "CargosSubmission" cs
        WHERE cs."companyId" = ${q.companyId}::uuid
          AND cs."createdAt" >= ${from}
          AND cs."createdAt" <= ${to}
        GROUP BY 1, cs.status
        ORDER BY 1 ASC
      `;
    };

    const [revenueAgg, bySource, byStatusCreated, cargosGrouped, fleetVehicles, overlapReservations, cargosDailyRows] =
      await Promise.all([
        this.prisma.reservation.aggregate({
          where: {
            ...resWhere,
            status: 'COMPLETED',
            returnAt: { gte: from, lte: to },
            totalCents: { not: null },
          },
          _sum: { totalCents: true },
          _count: { _all: true },
        }),
        this.prisma.reservation.groupBy({
          by: ['source'],
          where: {
            ...resWhere,
            createdAt: { gte: from, lte: to },
          },
          _count: { _all: true },
        }),
        this.prisma.reservation.groupBy({
          by: ['status'],
          where: {
            ...resWhere,
            createdAt: { gte: from, lte: to },
          },
          _count: { _all: true },
        }),
        this.prisma.cargosSubmission.groupBy({
          by: ['status'],
          where: cargosWhere,
          _count: { _all: true },
        }),
        this.prisma.vehicle.findMany({
          where: vehicleWhere,
          select: {
            id: true,
            vehicleClassId: true,
            vehicleClass: { select: { name: true, code: true } },
          },
        }),
        this.prisma.reservation.findMany({
          where: {
            ...resWhere,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            pickupAt: { lt: rangeEndExcl },
            returnAt: { gt: rangeStart },
          },
          select: {
            pickupAt: true,
            returnAt: true,
            vehicle: {
              select: {
                vehicleClassId: true,
                vehicleClass: { select: { name: true, code: true } },
              },
            },
          },
        }),
        cargosDailySql(),
      ]);

    const byClassVehicles = new Map<string, { name: string; code: string; count: number }>();
    for (const v of fleetVehicles) {
      const cur = byClassVehicles.get(v.vehicleClassId);
      if (cur) {
        cur.count += 1;
      } else {
        byClassVehicles.set(v.vehicleClassId, {
          name: v.vehicleClass.name,
          code: v.vehicleClass.code,
          count: 1,
        });
      }
    }

    const classBookedMs = new Map<string, number>();
    let totalBookedMs = 0;
    for (const r of overlapReservations) {
      const ms = overlapMsHalfOpen(r.pickupAt, r.returnAt, rangeStart, rangeEndExcl);
      if (ms <= 0) {
        continue;
      }
      totalBookedMs += ms;
      const cid = r.vehicle.vehicleClassId;
      classBookedMs.set(cid, (classBookedMs.get(cid) ?? 0) + ms);
    }

    const fleetVehicleCount = fleetVehicles.length;
    const capacityMs = rangeMs * fleetVehicleCount;
    const fleetUtilizationPercent =
      fleetVehicleCount > 0 && capacityMs > 0
        ? Math.min(100, (totalBookedMs / capacityMs) * 100)
        : null;

    const byVehicleClass = [...byClassVehicles.entries()]
      .map(([vehicleClassId, meta]) => {
        const bookedMs = classBookedMs.get(vehicleClassId) ?? 0;
        const cap = rangeMs * meta.count;
        return {
          vehicleClassId,
          className: meta.name,
          classCode: meta.code,
          vehicleCount: meta.count,
          bookedMsInRange: bookedMs,
          utilizationPercent:
            meta.count > 0 && cap > 0 ? Math.min(100, (bookedMs / cap) * 100) : null,
        };
      })
      .sort((a, b) => a.className.localeCompare(b.className));

    const nCargos = (s: string) => cargosGrouped.find((r) => r.status === s)?._count._all ?? 0;
    const cargosAtAGlance = {
      totalCreated: cargosGrouped.reduce((a, r) => a + r._count._all, 0),
      inFlight: nCargos('PENDING') + nCargos('PROCESSING'),
      mockSent: nCargos('MOCK_SENT'),
      failed: nCargos('FAILED'),
      skipped: nCargos('SKIPPED'),
    };

    const dayMap = new Map<string, Record<string, number>>();
    for (const row of cargosDailyRows) {
      const dayKey =
        row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
      const st = row.status;
      const n = Number(row.cnt);
      const rec = dayMap.get(dayKey) ?? {};
      rec[st] = (rec[st] ?? 0) + n;
      dayMap.set(dayKey, rec);
    }

    const cargosDailyCreated = eachUtcDayInclusive(q.from, q.to).map((dayStr) => {
      const fromRow = dayMap.get(dayStr) ?? {};
      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const st of CARGOS_DAILY_STATUS_ORDER) {
        const c = fromRow[st] ?? 0;
        byStatus[st] = c;
        total += c;
      }
      for (const [k, v] of Object.entries(fromRow)) {
        if (!CARGOS_DAILY_STATUS_ORDER.includes(k as (typeof CARGOS_DAILY_STATUS_ORDER)[number])) {
          byStatus[k] = v;
          total += v;
        }
      }
      return { day: dayStr, byStatus, total };
    });

    return {
      companyId: co.id,
      companyName: co.name,
      from: q.from,
      to: q.to,
      completedRevenueCents: revenueAgg._sum.totalCents ?? 0,
      completedReservationsInReturnWindow: revenueAgg._count._all,
      reservationsCreatedInRange: {
        bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])) as Record<string, number>,
        byStatus: Object.fromEntries(byStatusCreated.map((r) => [r.status, r._count._all])) as Record<string, number>,
      },
      cargosSubmissionsCreatedInRange: Object.fromEntries(
        cargosGrouped.map((r) => [r.status, r._count._all]),
      ) as Record<string, number>,
      cargosAtAGlance,
      cargosDailyCreated,
      utilization: {
        definitionKey: COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY,
        calendarDaysInRange,
        fleetVehicleCount,
        bookedMsInRange: totalBookedMs,
        fleetUtilizationPercent,
        byVehicleClass,
      },
    };
  }

  /** G3 — documents in OCR queue for a company (PENDING, upload complete, not applied). */
  async listCustomerDocumentsOcrPending(q: CustomerDocumentsOcrPendingQuery, user: JwtUser) {
    if (!isAdminCrossCompany(user)) {
      if (q.companyId !== user.companyId) {
        throw new ForbiddenException('Not allowed to access this company');
      }
    }
    const co = await this.prisma.company.findFirst({ where: { id: q.companyId }, select: { id: true } });
    if (!co) {
      throw new BadRequestException('Company not found');
    }
    const limit = q.limit ?? 100;
    const items = await this.prisma.customerDocument.findMany({
      where: {
        ocrStatus: 'PENDING',
        uploadCompletedAt: { not: null },
        ocrAppliedAt: null,
        customer: { companyId: q.companyId },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        docType: true,
        originalName: true,
        createdAt: true,
        ocrVendor: true,
        customer: { select: { id: true, name: true, email: true } },
      },
    });
    return { companyId: q.companyId, limit, items };
  }
}
