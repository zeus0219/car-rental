import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CreateRentalAgreementInput,
  SignRentalAgreementInput,
  UpdateRentalAgreementInput,
} from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../auth/types';
import { assertAgentReservationInScope, assertSameCompany } from '../auth/company-access';
import { CargosService } from '../integrations/cargos/cargos.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { assertDeskEmailB4ForReservation } from '../organization/customer/customer-b4-email.util';
import { RentalAgreementPdfService } from './rental-agreement-pdf.service';

function cargosAutoEnqueueOnSign(): boolean {
  const v = process.env.CARGOS_AUTO_ENQUEUE_ON_SIGN;
  if (v === undefined || v === '') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  return true;
}

const completedAttachmentsOnly = {
  OR: [
    { storage: 'LOCAL' as const },
    { uploadCompletedAt: { not: null } },
  ],
};

const agreementWithAttachments = {
  include: {
    attachments: {
      where: completedAttachmentsOnly,
      orderBy: { createdAt: 'asc' as const },
    },
  },
} as const;

@Injectable()
export class RentalAgreementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cargos: CargosService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly pdf: RentalAgreementPdfService,
  ) {}

  private async loadAgreementDocumentContext(id: string, user: JwtUser) {
    const row = await this.prisma.rentalAgreement.findUnique({
      where: { id },
      include: {
        attachments: agreementWithAttachments.include.attachments,
        reservation: {
          include: {
            company: { select: { name: true } },
            vehicle: { include: { vehicleClass: { select: { name: true } } } },
            pickupStation: { select: { name: true, city: true } },
            returnStation: { select: { name: true, city: true } },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(`Rental agreement not found: ${id}`);
    }
    assertSameCompany(user, row.companyId, `Rental agreement not found: ${id}`);
    assertAgentReservationInScope(
      user,
      row.reservation.pickupStationId,
      row.reservation.returnStationId,
      `Rental agreement not found: ${id}`,
    );
    return row;
  }

  async getByReservationId(reservationId: string, user: JwtUser) {
    const r = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${reservationId}`);
    }
    assertSameCompany(user, r.companyId, `Reservation not found: ${reservationId}`);
    assertAgentReservationInScope(
      user,
      r.pickupStationId,
      r.returnStationId,
      `Reservation not found: ${reservationId}`,
    );
    const a = await this.prisma.rentalAgreement.findUnique({
      where: { reservationId },
      ...agreementWithAttachments,
    });
    if (!a) {
      throw new NotFoundException('No rental agreement for this reservation yet');
    }
    assertSameCompany(user, a.companyId, 'Rental agreement not found');
    return a;
  }

  async getById(id: string, user: JwtUser) {
    const a = await this.prisma.rentalAgreement.findUnique({
      where: { id },
      include: {
        attachments: agreementWithAttachments.include.attachments,
        reservation: { select: { pickupStationId: true, returnStationId: true } },
      },
    });
    if (!a) {
      throw new NotFoundException(`Rental agreement not found: ${id}`);
    }
    assertSameCompany(user, a.companyId, `Rental agreement not found: ${id}`);
    assertAgentReservationInScope(
      user,
      a.reservation.pickupStationId,
      a.reservation.returnStationId,
      `Rental agreement not found: ${id}`,
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { reservation, ...agreement } = a;
    return agreement;
  }

  async create(data: CreateRentalAgreementInput, user: JwtUser) {
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
    const existing = await this.prisma.rentalAgreement.findUnique({
      where: { reservationId: data.reservationId },
    });
    if (existing) {
      throw new ConflictException('A rental agreement already exists for this reservation');
    }
    return this.prisma.rentalAgreement.create({
      data: {
        companyId: r.companyId,
        reservationId: r.id,
        body: data.body,
        status: 'DRAFT',
        agreementTemplateVersion: data.agreementTemplateVersion?.trim() ?? null,
      },
      ...agreementWithAttachments,
    });
  }

  async update(id: string, data: UpdateRentalAgreementInput, user: JwtUser) {
    const a = await this.getById(id, user);
    if (a.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT agreements can be edited');
    }
    return this.prisma.rentalAgreement.update({
      where: { id },
      data: {
        body: data.body,
        ...(data.agreementTemplateVersion !== undefined
          ? { agreementTemplateVersion: data.agreementTemplateVersion }
          : {}),
      },
      ...agreementWithAttachments,
    });
  }

  async sign(
    id: string,
    data: SignRentalAgreementInput,
    user: JwtUser,
    audit: { clientIp: string | null; userAgent: string | null },
  ) {
    const a = await this.getById(id, user);
    if (a.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT agreements can be signed');
    }
    const updated = await this.prisma.rentalAgreement.update({
      where: { id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        signedByName: data.signedByName,
        signedClientIp: audit.clientIp,
        signedUserAgent: audit.userAgent,
      },
      ...agreementWithAttachments,
    });
    if (cargosAutoEnqueueOnSign()) {
      try {
        await this.cargos.enqueue({ reservationId: updated.reservationId }, user);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await this.audit.log({
          userId: user.sub,
          action: 'rental_agreement.cargos_auto_enqueue_failed',
          entity: 'Reservation',
          entityId: updated.reservationId,
          metadata: { agreementId: id, error: msg.slice(0, 500) },
          ip: audit.clientIp,
          userAgent: audit.userAgent,
        });
      }
    }
    return updated;
  }

  async voidDraft(id: string, user: JwtUser) {
    const a = await this.getById(id, user);
    if (a.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT agreements can be voided');
    }
    return this.prisma.rentalAgreement.update({
      where: { id },
      data: { status: 'VOID' },
      ...agreementWithAttachments,
    });
  }

  private pdfInputFromRow(
    row: Awaited<ReturnType<RentalAgreementService['loadAgreementDocumentContext']>>,
  ) {
    const r = row.reservation;
    const plate = r.vehicle?.licensePlate?.trim() ?? '';
    const model = r.vehicle?.modelLabel?.trim() ?? '';
    const cls = r.vehicle?.vehicleClass?.name?.trim() ?? '';
    const vehicleBits = [plate, model, cls].filter(Boolean);
    return {
      companyName: r.company.name,
      reservationId: r.id,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: r.customerPhone,
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      totalCents: r.totalCents,
      currency: r.currency || 'EUR',
      vehicleLine: vehicleBits.length ? vehicleBits.join(' · ') : null,
      pickupStationLine: r.pickupStation
        ? `${r.pickupStation.name}${r.pickupStation.city ? ` — ${r.pickupStation.city}` : ''}`
        : null,
      returnStationLine: r.returnStation
        ? `${r.returnStation.name}${r.returnStation.city ? ` — ${r.returnStation.city}` : ''}`
        : null,
      agreementStatus: row.status,
      agreementTemplateVersion: row.agreementTemplateVersion,
      signedByName: row.signedByName,
      signedAt: row.signedAt,
      body: row.body,
      annexNames: row.attachments.map((a) => a.originalName),
    };
  }

  async renderPdfBuffer(id: string, user: JwtUser): Promise<Uint8Array> {
    const row = await this.loadAgreementDocumentContext(id, user);
    return this.pdf.buildPdf(this.pdfInputFromRow(row));
  }

  /** Desk: email signed agreement PDF to guest (B4 gate when company privacy register is non-empty). */
  async sendAgreementPdfEmail(
    id: string,
    user: JwtUser,
    ctx: { ip?: string; userAgent?: string },
  ): Promise<{ ok: true }> {
    const row = await this.loadAgreementDocumentContext(id, user);
    if (row.status !== 'SIGNED') {
      throw new BadRequestException('Only SIGNED rental agreements can be emailed to the customer.');
    }
    const to = row.reservation.customerEmail?.trim();
    if (!to?.includes('@')) {
      throw new BadRequestException('Reservation has no valid customer email address.');
    }
    if (!this.mail.isEnabled()) {
      throw new ServiceUnavailableException('Outbound email is not configured (SMTP).');
    }
    const { b4Consent } = await assertDeskEmailB4ForReservation(this.prisma, {
      companyId: row.companyId,
      customerId: row.reservation.customerId,
    });
    const pdfBytes = await this.pdf.buildPdf(this.pdfInputFromRow(row));
    await this.mail.sendRentalAgreementPdfEmail({
      to,
      customerName: row.reservation.customerName,
      reservationId: row.reservation.id,
      companyId: row.companyId,
      agreementTemplateVersion: row.agreementTemplateVersion,
      pdfBytes,
    });
    const toHash = createHash('sha256').update(to.toLowerCase()).digest('hex').slice(0, 16);
    await this.audit.log({
      userId: user.sub,
      action: 'rental_agreement.email_pdf',
      entity: 'RentalAgreement',
      entityId: row.id,
      metadata: {
        reservationId: row.reservationId,
        toSha256Prefix: toHash,
        agreementTemplateVersion: row.agreementTemplateVersion,
        b4Consent,
      },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { ok: true };
  }
}
