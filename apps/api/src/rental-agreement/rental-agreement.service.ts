import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  ) {}

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
}
