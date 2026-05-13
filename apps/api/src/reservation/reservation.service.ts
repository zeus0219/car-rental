import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { reservationNonBlockingStatusValues } from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../prisma/prisma-errors';
import { halfOpenRangesOverlap } from '../fleet/intervals';
import { AuditService } from '../audit/audit.service';
import { JwtUser } from '../auth/types';
import {
  assertAgentMayUsePickupStation,
  assertAgentReservationInScope,
  assertCreateBodyCompanyId,
  assertSameCompany,
  isAdminCrossCompany,
} from '../auth/company-access';
import { AvailabilityService } from '../fleet/availability/availability.service';
import { MailService } from '../mail/mail.service';
import { PartnerWebhookService } from '../partner/partner-webhook.service';
import { SmsService } from '../sms/sms.service';
import { signPublicBookingMagicLink, verifyPublicBookingMagicLink } from './booking-magic-link';
import {
  CreateReservationInput,
  PublicCreateQuoteBatchInput,
  PublicCreateQuoteInput,
  PublicRequestBookingViewLinkInput,
  type ReservationCompanySummary,
  reservationStatusValues,
  countRentalDays24h,
  sumClassRentCents24h,
  UpdateReservationInput,
} from '@car-rental/shared';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  assertInProgressHandoverGates,
  computeHandoverGate,
  handoverRequiresVerifiedIdDocuments,
  ID_STYLE_DOCUMENT_TYPES,
} from './reservation-handover.util';
import {
  assertReturnCompletionGates,
  computeReturnCompletionGate,
} from './reservation-return-completion.util';

const ACTIVE_STATUS_FILTER = { notIn: [...reservationNonBlockingStatusValues] };

const PUBLIC_GUEST_BOOKING_INCLUDE = {
  company: { select: { name: true } },
  vehicle: { include: { vehicleClass: { select: { name: true, code: true } } } },
  pickupStation: {
    select: { id: true, name: true, code: true, city: true, province: true },
  },
  returnStation: {
    select: { id: true, name: true, code: true, city: true, province: true },
  },
  extraLines: { orderBy: { sortOrder: 'asc' as const }, select: { label: true, amountCents: true } },
} as const;

/** Prisma return shapes may omit new columns until `prisma generate` is run. */
type ReservationOdometerSync = {
  status: string;
  vehicleId: string;
  odometerInKm: number | null;
};

function odometerSyncFromUpdated(r: { status: string; vehicleId: string } & Record<string, unknown>): ReservationOdometerSync {
  const v = r['odometerInKm'] as number | null | undefined;
  return {
    status: r.status,
    vehicleId: r.vehicleId,
    odometerInKm: typeof v === 'number' ? v : null,
  };
}

/** Canonical JSON for idempotency body hash (`Dates` → ISO). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  private static readonly partnerReservationInclude = {
    vehicle: { include: { vehicleClass: true } },
    pickupStation: { select: { id: true, name: true, code: true } },
    returnStation: { select: { id: true, name: true, code: true } },
    extraLines: { orderBy: { sortOrder: 'asc' as const } },
    customer: { select: { id: true, name: true, email: true, phone: true } },
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
    private readonly partnerWebhook: PartnerWebhookService,
  ) {}

  async list(
    q: {
      companyId?: string;
      vehicleId?: string;
      customerId?: string;
      status?: string;
      statuses?: (typeof reservationStatusValues)[number][];
      from?: Date;
      to?: Date;
      source?: 'STAFF' | 'PUBLIC_WEB' | 'PARTNER';
    },
    user: JwtUser,
  ) {
    let companyId = q.companyId;
    if (!isAdminCrossCompany(user)) {
      if (companyId && companyId !== user.companyId) {
        throw new ForbiddenException('Not allowed to access this company');
      }
      companyId = user.companyId;
    }
    if (q.source && !companyId) {
      throw new BadRequestException('companyId is required when filtering by source');
    }

    if (q.customerId) {
      const cust = await this.prisma.customer.findUnique({
        where: { id: q.customerId },
        select: { companyId: true },
      });
      if (!cust) {
        throw new NotFoundException(`Customer not found: ${q.customerId}`);
      }
      assertSameCompany(user, cust.companyId, `Customer not found: ${q.customerId}`);
      if (companyId && cust.companyId !== companyId) {
        throw new BadRequestException('customerId does not belong to the requested company');
      }
      if (!companyId && isAdminCrossCompany(user)) {
        companyId = cust.companyId;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(companyId && { companyId }),
      ...(q.vehicleId && { vehicleId: q.vehicleId }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.statuses?.length
        ? { status: { in: q.statuses } }
        : q.status
          ? { status: q.status }
          : {}),
      ...(q.source && { source: q.source }),
      ...(q.from &&
        q.to && {
          AND: [{ pickupAt: { lt: q.to } }, { returnAt: { gt: q.from } }],
        }),
    };
    if (user.role === 'AGENT' && user.stationId) {
      where.OR = [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }];
    }
    if (Object.keys(where).length === 0) {
      throw new BadRequestException('Provide at least one filter, e.g. companyId, vehicleId, or from+to');
    }
    return this.prisma.reservation.findMany({
      where,
      orderBy: { pickupAt: 'asc' },
      include: {
        vehicle: { include: { vehicleClass: true } },
        pickupStation: { select: { id: true, name: true, code: true } },
        returnStation: { select: { id: true, name: true, code: true } },
        extraLines: { orderBy: { sortOrder: 'asc' } },
        rentalAgreement: {
          select: {
            id: true,
            status: true,
            agreementTemplateVersion: true,
            signedAt: true,
            signedByName: true,
            signedClientIp: true,
            _count: { select: { attachments: true } },
          },
        },
        damageReport: {
          select: {
            id: true,
            status: true,
            notes: true,
            _count: { select: { photos: true, lines: true } },
          },
        },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        createdByPartnerApiKey: { select: { id: true, name: true } },
      },
    });
  }

  async getSummary(companyId: string, user: JwtUser): Promise<ReservationCompanySummary> {
    if (!isAdminCrossCompany(user)) {
      if (companyId !== user.companyId) {
        throw new ForbiddenException('Not allowed to access this company');
      }
    }
    const where: Prisma.ReservationWhereInput = { companyId };
    if (user.role === 'AGENT' && user.stationId) {
      where.OR = [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }];
    }
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [grouped, publicWebOpenQuotes, upcomingPickupsNext7Days] = await Promise.all([
      this.prisma.reservation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.reservation.count({
        where: { ...where, source: 'PUBLIC_WEB', status: 'QUOTE' },
      }),
      this.prisma.reservation.count({
        where: {
          ...where,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] },
          pickupAt: { gte: now, lt: in7d },
        },
      }),
    ]);
    const byStatus = Object.fromEntries(
      reservationStatusValues.map((s) => [s, 0]),
    ) as Record<(typeof reservationStatusValues)[number], number>;
    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
    }
    return {
      companyId,
      byStatus,
      publicWebOpenQuotes,
      upcomingPickupsNext7Days,
    };
  }

  private async getScopedReservationRecord(id: string, user: JwtUser) {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        vehicle: { include: { vehicleClass: true, homeStation: true } },
        pickupStation: true,
        returnStation: true,
        company: {
          select: {
            id: true,
            name: true,
            cargosInScope: true,
            cargosAdapter: true,
            cargosCutoffMinutesBeforePickup: true,
          },
        },
        extraLines: { orderBy: { sortOrder: 'asc' } },
        rentalAgreement: {
          include: { attachments: { orderBy: { createdAt: 'asc' } } },
        },
        customer: { select: { id: true, name: true, email: true, phone: true } },
        createdByPartnerApiKey: { select: { id: true, name: true } },
        cargosSubmissions: { orderBy: { createdAt: 'desc' } },
        cargosHandoverOverrideBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        operationPhotos: {
          where: {
            OR: [{ storage: 'LOCAL' }, { uploadCompletedAt: { not: null } }],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            phase: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
        damageReport: {
          include: {
            lines: { orderBy: { sortOrder: 'asc' } },
            photos: {
              where: {
                OR: [{ storage: 'LOCAL' }, { uploadCompletedAt: { not: null } }],
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${id}`);
    }
    assertSameCompany(user, r.companyId, `Reservation not found: ${id}`);
    assertAgentReservationInScope(
      user,
      r.pickupStationId,
      r.returnStationId,
      `Reservation not found: ${id}`,
    );
    return r;
  }

  private async countCompletedIdStyleDocuments(companyId: string, customerId: string) {
    const where: Prisma.CustomerDocumentWhereInput = {
      companyId,
      customerId,
      docType: { in: [...ID_STYLE_DOCUMENT_TYPES] },
      OR: [{ storage: 'LOCAL' as const }, { uploadCompletedAt: { not: null } }],
    };
    if (handoverRequiresVerifiedIdDocuments()) {
      where.verifiedAt = { not: null };
    }
    return this.prisma.customerDocument.count({ where });
  }

  async getOne(id: string, user: JwtUser) {
    const r = await this.getScopedReservationRecord(id, user);
    const idCount = r.customerId
      ? await this.countCompletedIdStyleDocuments(r.companyId, r.customerId)
      : 0;
    const handoverGate = computeHandoverGate(
      {
        id: r.id,
        companyId: r.companyId,
        status: r.status,
        pickupAt: r.pickupAt,
        cargosCutoffMinutesBeforePickup: r.company.cargosCutoffMinutesBeforePickup,
        customerId: r.customerId,
        rentalAgreement: r.rentalAgreement ? { status: r.rentalAgreement.status } : null,
        cargosHandoverOverrideAt: r.cargosHandoverOverrideAt,
        cargosSubmissions: r.cargosSubmissions,
      },
      idCount,
      { cargosInScope: r.company.cargosInScope, cargosAdapter: r.company.cargosAdapter },
    );
    const returnCompletionGate = computeReturnCompletionGate({
      odometerInKm: r.odometerInKm ?? null,
      fuelInPercent: r.fuelInPercent ?? null,
      returnChecklistJson: r.returnChecklistJson,
    });
    return { ...r, handoverGate, returnCompletionGate };
  }

  async create(
    data: CreateReservationInput,
    ctx: { user: JwtUser; actorUserId: string; ip?: string; userAgent?: string },
  ) {
    assertCreateBodyCompanyId(ctx.user, data.companyId);
    assertAgentMayUsePickupStation(ctx.user, data.pickupStationId);
    this.assertTimeOrder(data.pickupAt, data.returnAt);
    const status = data.status ?? 'QUOTE';
    await this.assertCompanyCoherent(data);
    await this.assertVehicleFree(
      data.vehicleId,
      data.pickupAt,
      data.returnAt,
    );
    const contact = await this.resolveCustomerContactForCreate(data);
    const totalCents = await this.resolveTotalCents(data);
    const lineCreates = (data.extraLines ?? []).map((e, i) => ({
      label: e.label,
      amountCents: e.amountCents,
      sortOrder: i,
    }));
    const created = await this.prisma.reservation.create({
      data: {
        companyId: data.companyId,
        vehicleId: data.vehicleId,
        pickupStationId: data.pickupStationId,
        returnStationId: data.returnStationId,
        pickupAt: data.pickupAt,
        returnAt: data.returnAt,
        status,
        source: 'STAFF',
        customerId: contact.customerId,
        customerName: contact.customerName,
        customerEmail: contact.customerEmail,
        customerPhone: contact.customerPhone,
        totalCents,
        currency: data.currency,
        notes: data.notes,
        extraLines: lineCreates.length
          ? {
              create: lineCreates,
            }
          : undefined,
      },
      include: {
        vehicle: { include: { vehicleClass: true } },
        pickupStation: { select: { id: true, name: true, code: true } },
        returnStation: { select: { id: true, name: true, code: true } },
        extraLines: { orderBy: { sortOrder: 'asc' } },
        customer: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    await this.audit.log({
      userId: ctx.actorUserId,
      action: 'reservation.create',
      entity: 'Reservation',
      entityId: created.id,
      metadata: { status: created.status, vehicleId: data.vehicleId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return created;
  }

  /**
   * G2: same rules as staff `create`, but `source: PARTNER` and scoped by API key (no branch-agent pickup restriction).
   * Optional **`Idempotency-Key`** header (max 256 chars): same key + same body → same reservation; same key + different body → **409**.
   */
  async createForPartner(
    data: CreateReservationInput,
    ctx: {
      companyId: string;
      partnerApiKeyId: string;
      ip?: string;
      userAgent?: string;
      idempotencyKey?: string | null;
    },
  ) {
    if (data.companyId !== ctx.companyId) {
      throw new ForbiddenException('companyId does not match API key');
    }

    let keyHash: string | null = null;
    let bodyHash: string | null = null;
    const rawKey = ctx.idempotencyKey?.trim();
    if (rawKey) {
      if (rawKey.length > 256) {
        throw new BadRequestException('Idempotency-Key must be at most 256 characters');
      }
      keyHash = createHash('sha256').update(rawKey, 'utf8').digest('hex');
      bodyHash = createHash('sha256').update(stableStringify(data), 'utf8').digest('hex');
      const existing = await this.prisma.partnerReservationIdempotency.findUnique({
        where: {
          partnerApiKeyId_keyHash: {
            partnerApiKeyId: ctx.partnerApiKeyId,
            keyHash,
          },
        },
      });
      if (existing) {
        if (existing.bodyHash !== bodyHash) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different request payload',
          );
        }
        const row = await this.prisma.reservation.findFirst({
          where: { id: existing.reservationId, companyId: ctx.companyId, source: 'PARTNER' },
          include: ReservationService.partnerReservationInclude,
        });
        if (!row) {
          throw new ConflictException(
            'Idempotency record exists but reservation is missing or no longer PARTNER-sourced',
          );
        }
        return row;
      }
    }

    this.assertTimeOrder(data.pickupAt, data.returnAt);
    const status = data.status ?? 'QUOTE';
    await this.assertCompanyCoherent(data);
    await this.assertVehicleFree(data.vehicleId, data.pickupAt, data.returnAt);
    const contact = await this.resolveCustomerContactForCreate(data);
    const totalCents = await this.resolveTotalCents(data);
    const lineCreates = (data.extraLines ?? []).map((e, i) => ({
      label: e.label,
      amountCents: e.amountCents,
      sortOrder: i,
    }));

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.reservation.create({
          data: {
            companyId: data.companyId,
            vehicleId: data.vehicleId,
            pickupStationId: data.pickupStationId,
            returnStationId: data.returnStationId,
            pickupAt: data.pickupAt,
            returnAt: data.returnAt,
            status,
            source: 'PARTNER',
            createdByPartnerApiKeyId: ctx.partnerApiKeyId,
            customerId: contact.customerId,
            customerName: contact.customerName,
            customerEmail: contact.customerEmail,
            customerPhone: contact.customerPhone,
            totalCents,
            currency: data.currency,
            notes: data.notes,
            extraLines: lineCreates.length
              ? {
                  create: lineCreates,
                }
              : undefined,
          },
          include: ReservationService.partnerReservationInclude,
        });
        if (keyHash && bodyHash) {
          await tx.partnerReservationIdempotency.create({
            data: {
              partnerApiKeyId: ctx.partnerApiKeyId,
              keyHash,
              bodyHash,
              reservationId: row.id,
            },
          });
        }
        return row;
      });
      await this.audit.log({
        userId: null,
        action: 'reservation.create',
        entity: 'Reservation',
        entityId: created.id,
        metadata: {
          status: created.status,
          vehicleId: data.vehicleId,
          channel: 'partner_api',
          partnerApiKeyId: ctx.partnerApiKeyId,
          idempotent: Boolean(keyHash),
        },
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
      await this.partnerWebhook.enqueueReservationCreated(ctx.partnerApiKeyId, created.id);
      return created;
    } catch (e) {
      if (
        keyHash &&
        bodyHash &&
        e instanceof PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const dup = await this.prisma.partnerReservationIdempotency.findUnique({
          where: {
            partnerApiKeyId_keyHash: {
              partnerApiKeyId: ctx.partnerApiKeyId,
              keyHash,
            },
          },
        });
        if (dup) {
          if (dup.bodyHash !== bodyHash) {
            throw new ConflictException(
              'Idempotency-Key was already used with a different request payload',
            );
          }
          const row = await this.prisma.reservation.findFirst({
            where: { id: dup.reservationId, companyId: ctx.companyId, source: 'PARTNER' },
            include: ReservationService.partnerReservationInclude,
          });
          if (row) {
            return row;
          }
        }
      }
      throw e;
    }
  }

  /** G2: read a single PARTNER-sourced reservation for the key holder’s company (no staff JWT). */
  async getOneForPartner(id: string, companyId: string) {
    const r = await this.prisma.reservation.findFirst({
      where: { id, companyId, source: 'PARTNER' },
      include: ReservationService.partnerReservationInclude,
    });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${id}`);
    }
    return r;
  }

  /**
   * G2: list PARTNER-sourced reservations for sync / reconciliation (newest `createdAt` first).
   */
  async listForPartner(
    companyId: string,
    opts: { limit: number; offset: number; status?: string },
  ) {
    const st = opts.status?.trim();
    if (st) {
      if (!reservationStatusValues.includes(st as (typeof reservationStatusValues)[number])) {
        throw new BadRequestException('Invalid status filter');
      }
    }
    const where: Prisma.ReservationWhereInput = {
      companyId,
      source: 'PARTNER',
      ...(st ? { status: st as (typeof reservationStatusValues)[number] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.reservation.count({ where }),
      this.prisma.reservation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: opts.offset,
        take: opts.limit,
        include: ReservationService.partnerReservationInclude,
      }),
    ]);
    return { items: rows, total, limit: opts.limit, offset: opts.offset };
  }

  /**
   * G2: partner PATCH cancel — only **QUOTE** / **PENDING_PAYMENT** / **CONFIRMED**, no **`paidAt`**, no active deposit hold.
   * Idempotent when already **CANCELLED**. Enqueues **`reservation.cancelled`** webhook when configured.
   */
  async cancelForPartner(
    id: string,
    ctx: {
      companyId: string;
      partnerApiKeyId: string;
      ip?: string;
      userAgent?: string;
    },
  ) {
    const current = await this.prisma.reservation.findFirst({
      where: { id, companyId: ctx.companyId, source: 'PARTNER' },
    });
    if (!current) {
      throw new NotFoundException(`Reservation not found: ${id}`);
    }
    if (current.status === 'CANCELLED') {
      return this.getOneForPartner(id, ctx.companyId);
    }
    const allowedBeforeCancel = new Set<string>(['QUOTE', 'PENDING_PAYMENT', 'CONFIRMED']);
    if (!allowedBeforeCancel.has(current.status)) {
      throw new ConflictException(
        'Partner can only cancel reservations in QUOTE, PENDING_PAYMENT, or CONFIRMED status',
      );
    }
    if (current.paidAt != null) {
      throw new ConflictException(
        'Cannot cancel a reservation with recorded rental payment via partner API',
      );
    }
    const blockedDeposit = new Set(['PENDING', 'UNCAPTURED', 'CAPTURED']);
    if (blockedDeposit.has(current.depositHoldStatus)) {
      throw new ConflictException(
        'Cannot cancel while a deposit hold is active; contact the rental company or release the hold in desk',
      );
    }
    const previousStatus = current.status;
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: ReservationService.partnerReservationInclude,
    });
    await this.audit.log({
      userId: null,
      action: 'reservation.partner_cancel',
      entity: 'Reservation',
      entityId: id,
      metadata: {
        channel: 'partner_api',
        partnerApiKeyId: ctx.partnerApiKeyId,
        previousStatus,
      },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    await this.partnerWebhook.enqueueReservationCancelled(ctx.partnerApiKeyId, id, previousStatus);
    return updated;
  }

  /**
   * Public: create **QUOTE** with first free vehicle in class (same home-station rule as public availability).
   * Audit: no staff `userId` (source in metadata).
   */
  async createPublicQuote(
    data: PublicCreateQuoteInput,
    ctx: { ip?: string; userAgent?: string },
  ) {
    this.assertTimeOrder(data.pickupAt, data.returnAt);
    const avail = await this.availability.listAvailableVehiclesPublic(data.companyId, {
      stationId: data.stationId,
      from: data.pickupAt,
      to: data.returnAt,
      vehicleClassId: data.vehicleClassId,
    });
    if (avail.count < 1 || !avail.vehicles[0]) {
      throw new ConflictException(
        'No free vehicle in this class for the selected station and time window. Choose another time or class.',
      );
    }
    const vehicleId = avail.vehicles[0].id;
    const full: CreateReservationInput = {
      companyId: data.companyId,
      vehicleId,
      pickupStationId: data.pickupStationId,
      returnStationId: data.returnStationId,
      pickupAt: data.pickupAt,
      returnAt: data.returnAt,
      status: 'QUOTE',
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      notes: data.notes,
      currency: 'EUR',
      extraLines: data.extraLines,
    };
    await this.assertCompanyCoherent(full);
    await this.assertVehicleFree(vehicleId, data.pickupAt, data.returnAt);
    const totalCents = await this.resolveTotalCents(full);
    const lineCreates = (data.extraLines ?? []).map((e, i) => ({
      label: e.label,
      amountCents: e.amountCents,
      sortOrder: i,
    }));
    const customerId = await this.upsertCustomerFromPublicQuote(
      data.companyId,
      {
        name: data.customerName,
        email: data.customerEmail,
        phone: data.customerPhone,
      },
      {
        privacyNoticeVersion: data.privacyNoticeVersion,
        marketingEmailOptIn: data.marketingEmailOptIn ?? false,
      },
      ctx,
    );
    const publicViewToken = randomBytes(24).toString('hex');
    const publicViewTokenAt = new Date();
    const created = await this.prisma.reservation.create({
      data: {
        companyId: full.companyId,
        vehicleId: full.vehicleId,
        pickupStationId: full.pickupStationId,
        returnStationId: full.returnStationId,
        pickupAt: full.pickupAt,
        returnAt: full.returnAt,
        status: 'QUOTE',
        source: 'PUBLIC_WEB',
        customerId,
        customerName: full.customerName ?? '',
        customerEmail: full.customerEmail ?? '',
        customerPhone: full.customerPhone ?? '',
        totalCents,
        currency: full.currency,
        notes: full.notes,
        publicViewToken,
        publicViewTokenAt,
        extraLines: lineCreates.length ? { create: lineCreates } : undefined,
      },
      include: {
        vehicle: { include: { vehicleClass: true } },
        pickupStation: { select: { id: true, name: true, code: true, city: true } },
        returnStation: { select: { id: true, name: true, code: true, city: true } },
        extraLines: { orderBy: { sortOrder: 'asc' } },
      },
    });
    await this.audit.log({
      userId: null,
      action: 'reservation.create',
      entity: 'Reservation',
      entityId: created.id,
      metadata: {
        source: 'public',
        status: 'QUOTE',
        vehicleId,
        companyId: data.companyId,
        customerLinked: !!customerId,
      },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    if (this.mail.isEnabled()) {
      void this.mail
        .sendPublicQuoteSaved({
          to: created.customerEmail,
          customerName: created.customerName,
          reservationId: created.id,
          companyId: created.companyId,
          totalCents: created.totalCents,
          currency: created.currency,
          pickupAt: created.pickupAt,
          returnAt: created.returnAt,
          publicViewToken: created.publicViewToken,
        })
        .catch((err) => {
          this.logger.warn(
            `Public quote mail failed (${created.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    const createdWithStations = created as typeof created & {
      pickupStation: { id: string; name: string; code: string; city: string };
      returnStation: { id: string; name: string; code: string; city: string };
    };
    return {
      id: createdWithStations.id,
      status: createdWithStations.status,
      source: createdWithStations.source,
      totalCents: createdWithStations.totalCents,
      currency: createdWithStations.currency,
      pickupAt: createdWithStations.pickupAt,
      returnAt: createdWithStations.returnAt,
      companyId: createdWithStations.companyId,
      publicViewToken,
      pickupStation: createdWithStations.pickupStation,
      returnStation: createdWithStations.returnStation,
    };
  }

  /**
   * C1: multi-class basket — same trip and customer, one QUOTE per line; distinct vehicle classes only.
   * Uses one DB transaction for creates; re-checks slot conflicts inside the transaction.
   */
  async createPublicQuoteBatch(
    data: PublicCreateQuoteBatchInput,
    ctx: { ip?: string; userAgent?: string },
  ) {
    this.assertTimeOrder(data.pickupAt, data.returnAt);

    type Planned = { vehicleClassId: string; vehicleId: string; totalCents: number | null };
    const planned: Planned[] = [];
    const usedVehicleIds = new Set<string>();

    const fullBase: Omit<CreateReservationInput, 'vehicleId' | 'status'> = {
      companyId: data.companyId,
      pickupStationId: data.pickupStationId,
      returnStationId: data.returnStationId,
      pickupAt: data.pickupAt,
      returnAt: data.returnAt,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      notes: data.notes,
      currency: 'EUR',
      extraLines: data.extraLines,
    };

    for (const line of data.lines) {
      const avail = await this.availability.listAvailableVehiclesPublic(data.companyId, {
        stationId: data.stationId,
        from: data.pickupAt,
        to: data.returnAt,
        vehicleClassId: line.vehicleClassId,
      });
      const vehicles = avail.vehicles as { id: string }[];
      const pick = vehicles.find((v) => !usedVehicleIds.has(v.id));
      if (!pick) {
        throw new ConflictException(
          'No free vehicle for one of the selected classes for this station and time window. Adjust the basket or trip.',
        );
      }
      usedVehicleIds.add(pick.id);
      const full: CreateReservationInput = {
        ...fullBase,
        vehicleId: pick.id,
        status: 'QUOTE',
      };
      await this.assertCompanyCoherent(full);
      await this.assertVehicleFree(pick.id, data.pickupAt, data.returnAt);
      const totalCents = await this.resolveTotalCents(full);
      planned.push({ vehicleClassId: line.vehicleClassId, vehicleId: pick.id, totalCents });
    }

    const customerId = await this.upsertCustomerFromPublicQuote(
      data.companyId,
      {
        name: data.customerName,
        email: data.customerEmail,
        phone: data.customerPhone,
      },
      {
        privacyNoticeVersion: data.privacyNoticeVersion,
        marketingEmailOptIn: data.marketingEmailOptIn ?? false,
      },
      ctx,
    );

    const lineCreatesBatch = (data.extraLines ?? []).map((e, i) => ({
      label: e.label,
      amountCents: e.amountCents,
      sortOrder: i,
    }));

    const results: {
      id: string;
      status: string;
      source: 'PUBLIC_WEB';
      totalCents: number | null;
      currency: string;
      pickupAt: Date;
      returnAt: Date;
      companyId: string;
      publicViewToken: string;
      pickupStation: { id: string; name: string; code: string; city: string };
      returnStation: { id: string; name: string; code: string; city: string };
      vehicleClass: { name: string; code: string };
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < planned.length; i++) {
        const p = planned[i]!;
        await this.assertVehicleFreeTx(tx, p.vehicleId, data.pickupAt, data.returnAt);
        const publicViewToken = randomBytes(24).toString('hex');
        const publicViewTokenAt = new Date();
        const created = await tx.reservation.create({
          data: {
            companyId: data.companyId,
            vehicleId: p.vehicleId,
            pickupStationId: data.pickupStationId,
            returnStationId: data.returnStationId,
            pickupAt: data.pickupAt,
            returnAt: data.returnAt,
            status: 'QUOTE',
            source: 'PUBLIC_WEB',
            customerId,
            customerName: data.customerName,
            customerEmail: data.customerEmail,
            customerPhone: data.customerPhone,
            totalCents: p.totalCents,
            currency: 'EUR',
            notes: data.notes,
            publicViewToken,
            publicViewTokenAt,
            extraLines: lineCreatesBatch.length ? { create: lineCreatesBatch } : undefined,
          },
          include: {
            pickupStation: { select: { id: true, name: true, code: true, city: true } },
            returnStation: { select: { id: true, name: true, code: true, city: true } },
            vehicle: { include: { vehicleClass: { select: { name: true, code: true } } } },
          },
        });
        await this.audit.log({
          userId: null,
          action: 'reservation.create',
          entity: 'Reservation',
          entityId: created.id,
          metadata: {
            source: 'public_batch',
            batchIndex: i,
            batchSize: planned.length,
            vehicleId: p.vehicleId,
            companyId: data.companyId,
            customerLinked: !!customerId,
          },
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        });
        results.push({
          id: created.id,
          status: created.status,
          source: 'PUBLIC_WEB',
          totalCents: created.totalCents,
          currency: created.currency,
          pickupAt: created.pickupAt,
          returnAt: created.returnAt,
          companyId: created.companyId,
          publicViewToken,
          pickupStation: created.pickupStation,
          returnStation: created.returnStation,
          vehicleClass: {
            name: created.vehicle.vehicleClass.name,
            code: created.vehicle.vehicleClass.code,
          },
        });
      }
    });

    if (this.mail.isEnabled() && results[0]) {
      if (results.length === 1) {
        const r0 = results[0];
        void this.mail
          .sendPublicQuoteSaved({
            to: data.customerEmail,
            customerName: data.customerName,
            reservationId: r0!.id,
            companyId: data.companyId,
            totalCents: r0!.totalCents,
            currency: r0!.currency,
            pickupAt: r0!.pickupAt,
            returnAt: r0!.returnAt,
            publicViewToken: r0!.publicViewToken,
          })
          .catch((err) => {
            this.logger.warn(
              `Public quote mail failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } else {
        void this.mail
          .sendPublicQuoteBatchSaved({
            to: data.customerEmail,
            customerName: data.customerName,
            companyId: data.companyId,
            pickupAt: results[0]!.pickupAt,
            returnAt: results[0]!.returnAt,
            lines: results.map((r) => ({
              reservationId: r.id,
              totalCents: r.totalCents,
              currency: r.currency,
              vehicleClassLabel: `${r.vehicleClass.name} (${r.vehicleClass.code})`,
              publicViewToken: r.publicViewToken,
            })),
          })
          .catch((err) => {
            this.logger.warn(
              `Public batch quote mail failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    }

    if (results.length > 1 && this.sms.isEnabled() && this.sms.isPublicBatchAckEnabled()) {
      const to = this.sms.tryNormalizeE164(data.customerPhone);
      if (to) {
        const co = await this.prisma.company.findUnique({
          where: { id: data.companyId },
          select: { name: true },
        });
        const org = co?.name ?? 'Car rental';
        const msg = `${org}: ${results.length} quote bookings saved. Check your email for links and references.`;
        void this.sms.sendSms(to, msg);
      }
    }

    return { reservations: results };
  }

  /**
   * C3: unauthenticated read by `publicViewToken` for `PUBLIC_WEB` only.
   * Omits internal notes and Stripe ids; customer contact is summary-only.
   */
  async getPublicReservationByViewToken(token: string) {
    const r = await this.prisma.reservation.findFirst({
      where: { publicViewToken: token, source: 'PUBLIC_WEB' },
      include: PUBLIC_GUEST_BOOKING_INCLUDE,
    });
    if (!r) {
      throw new NotFoundException('Reservation not found');
    }
    return {
      id: r.id,
      status: r.status,
      companyName: r.company.name,
      companyId: r.companyId,
      vehicleClass: { name: r.vehicle.vehicleClass.name, code: r.vehicle.vehicleClass.code },
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      pickupStation: r.pickupStation,
      returnStation: r.returnStation,
      totalCents: r.totalCents,
      currency: r.currency,
      customerName: r.customerName,
      paidAt: r.paidAt,
      depositHoldStatus: r.depositHoldStatus,
      depositHoldCents: r.depositHoldCents,
      extraLines: r.extraLines.map((e) => ({ label: e.label, amountCents: e.amountCents })),
    };
  }

  /** C3: same payload as view-token after HMAC `magic` is verified (time-limited). */
  async getPublicReservationByMagicLink(magic: string) {
    const secret = this.config.get<string>('PUBLIC_BOOKING_MAGIC_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new NotFoundException('Reservation not found');
    }
    const v = verifyPublicBookingMagicLink(secret, magic);
    if (!v) {
      throw new NotFoundException('Reservation not found');
    }
    const r = await this.prisma.reservation.findFirst({
      where: { id: v.reservationId, source: 'PUBLIC_WEB' },
      include: PUBLIC_GUEST_BOOKING_INCLUDE,
    });
    if (!r) {
      throw new NotFoundException('Reservation not found');
    }
    return {
      id: r.id,
      status: r.status,
      companyName: r.company.name,
      companyId: r.companyId,
      vehicleClass: { name: r.vehicle.vehicleClass.name, code: r.vehicle.vehicleClass.code },
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      pickupStation: r.pickupStation,
      returnStation: r.returnStation,
      totalCents: r.totalCents,
      currency: r.currency,
      customerName: r.customerName,
      paidAt: r.paidAt,
      depositHoldStatus: r.depositHoldStatus,
      depositHoldCents: r.depositHoldCents,
      extraLines: r.extraLines.map((e) => ({ label: e.label, amountCents: e.amountCents })),
    };
  }

  /**
   * C3: email a signed magic link if reservation id + email match a PUBLIC_WEB booking (anti-enumeration: always ok).
   */
  async requestPublicBookingViewLink(
    data: PublicRequestBookingViewLinkInput,
    ctx: { ip?: string; userAgent?: string },
  ): Promise<{ ok: true }> {
    await new Promise((resolve) => setTimeout(resolve, 60 + Math.floor(Math.random() * 140)));
    const secret = this.config.get<string>('PUBLIC_BOOKING_MAGIC_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new ServiceUnavailableException('Booking link recovery is not configured');
    }
    const email = data.customerEmail.trim().toLowerCase();
    const r = await this.prisma.reservation.findFirst({
      where: { id: data.reservationId, source: 'PUBLIC_WEB' },
      select: {
        id: true,
        companyId: true,
        customerEmail: true,
        customerName: true,
      },
    });
    if (!r || r.customerEmail.trim().toLowerCase() !== email) {
      return { ok: true };
    }
    if (!this.mail.isEnabled()) {
      return { ok: true };
    }
    const rawTtl = this.config.get<string>('PUBLIC_BOOKING_MAGIC_TTL_MINUTES');
    const ttlMin = Math.max(
      15,
      Math.min(14 * 24 * 60, Number.parseInt(rawTtl ?? '4320', 10) || 4320),
    );
    const magic = signPublicBookingMagicLink(secret, r.id, ttlMin * 60);
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    if (!base) {
      this.logger.warn('requestPublicBookingViewLink: APP_PUBLIC_BASE_URL unset; not sending email');
      return { ok: true };
    }
    const url = `${base}/booking/view?magic=${encodeURIComponent(magic)}`;
    const ttlHr = Math.round(ttlMin / 60);
    void this.mail
      .sendPublicBookingMagicLinkEmail({
        to: email,
        customerName: r.customerName.trim() || 'customer',
        reservationId: r.id,
        companyId: r.companyId,
        magicUrl: url,
        ttlHours: ttlHr,
      })
      .catch((err) => {
        this.logger.warn(
          `Magic link mail failed (${r.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await this.audit.log({
      userId: null,
      action: 'public.booking_magic_link_requested',
      entity: 'Reservation',
      entityId: r.id,
      metadata: { source: 'public' },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { ok: true };
  }

  async update(id: string, data: UpdateReservationInput, user: JwtUser) {
    const current = await this.getScopedReservationRecord(id, user);
    const pickup = data.pickupAt ?? current.pickupAt;
    const ret = data.returnAt ?? current.returnAt;
    this.assertTimeOrder(pickup, ret);
    const companyId = current.companyId;
    const vehicleId = data.vehicleId ?? current.vehicleId;
    const pickupSt = data.pickupStationId ?? current.pickupStationId;
    const returnSt = data.returnStationId ?? current.returnStationId;
    assertAgentMayUsePickupStation(user, pickupSt);
    if (data.vehicleId || data.pickupStationId || data.returnStationId) {
      await this.assertCompanyCoherent({
        companyId,
        vehicleId,
        pickupStationId: pickupSt,
        returnStationId: returnSt,
      });
    }
    if (data.vehicleId || data.pickupAt || data.returnAt) {
      await this.assertVehicleFree(vehicleId, pickup, ret, id);
    }
    const d: Record<string, unknown> = {};
    if (data.vehicleId !== undefined) d.vehicleId = data.vehicleId;
    if (data.pickupStationId !== undefined) d.pickupStationId = data.pickupStationId;
    if (data.returnStationId !== undefined) d.returnStationId = data.returnStationId;
    if (data.pickupAt !== undefined) d.pickupAt = data.pickupAt;
    if (data.returnAt !== undefined) d.returnAt = data.returnAt;
    if (data.status !== undefined) d.status = data.status;
    if (data.customerId !== undefined) {
      if (data.customerId === null) {
        d.customerId = null;
        if (data.customerName !== undefined) d.customerName = (data.customerName as string).trim();
        if (data.customerEmail !== undefined) d.customerEmail = (data.customerEmail as string).trim().toLowerCase();
        if (data.customerPhone !== undefined) d.customerPhone = (data.customerPhone as string).trim();
      } else {
        const c = await this.prisma.customer.findFirst({
          where: { id: data.customerId, companyId },
        });
        if (!c) {
          throw new NotFoundException('Customer not found for this company');
        }
        d.customerId = c.id;
        d.customerName = (data.customerName !== undefined ? data.customerName : c.name).trim();
        d.customerEmail = (data.customerEmail !== undefined ? data.customerEmail : c.email)
          .trim()
          .toLowerCase();
        d.customerPhone = (data.customerPhone !== undefined ? data.customerPhone : c.phone).trim();
      }
    } else {
      if (data.customerName !== undefined) d.customerName = (data.customerName as string).trim();
      if (data.customerEmail !== undefined) d.customerEmail = (data.customerEmail as string).trim().toLowerCase();
      if (data.customerPhone !== undefined) d.customerPhone = (data.customerPhone as string).trim();
    }
    if (data.currency !== undefined) d.currency = data.currency;
    if (data.notes !== undefined) d.notes = data.notes;
    if (data.odometerOutKm !== undefined) d.odometerOutKm = data.odometerOutKm;
    if (data.odometerInKm !== undefined) d.odometerInKm = data.odometerInKm;
    if (data.fuelOutPercent !== undefined) d.fuelOutPercent = data.fuelOutPercent;
    if (data.fuelInPercent !== undefined) d.fuelInPercent = data.fuelInPercent;
    if (data.handoverChecklist !== undefined) {
      d.handoverChecklistJson = data.handoverChecklist as object;
    }
    if (data.returnChecklist !== undefined) {
      d.returnChecklistJson = data.returnChecklist as object;
    }
    if (data.handoverOpsNotes !== undefined) d.handoverOpsNotes = data.handoverOpsNotes;
    if (data.returnOpsNotes !== undefined) d.returnOpsNotes = data.returnOpsNotes;
    if (data.cargosHandoverOverride !== undefined) {
      if (user.role === 'AGENT') {
        throw new ForbiddenException('Only ADMIN or BRANCH_MANAGER can set a CaRGOS handover override');
      }
      if (data.cargosHandoverOverride === null) {
        d.cargosHandoverOverrideAt = null;
        d.cargosHandoverOverrideById = null;
        d.cargosHandoverOverrideReason = null;
      } else {
        d.cargosHandoverOverrideAt = new Date();
        d.cargosHandoverOverrideById = user.sub;
        d.cargosHandoverOverrideReason = data.cargosHandoverOverride.reason;
      }
    }
    const nextStatus = data.status !== undefined ? data.status : current.status;
    if (nextStatus === 'IN_PROGRESS' && current.status !== 'IN_PROGRESS') {
      const idCount = current.customerId
        ? await this.countCompletedIdStyleDocuments(current.companyId, current.customerId)
        : 0;
      const overrideIntent =
        data.cargosHandoverOverride === undefined
          ? ({ kind: 'unchanged' } as const)
          : data.cargosHandoverOverride === null
            ? ({ kind: 'clear' } as const)
            : ({ kind: 'set' } as const);
      assertInProgressHandoverGates(
        {
          id: current.id,
          companyId: current.companyId,
          status: current.status,
          pickupAt: current.pickupAt,
          cargosCutoffMinutesBeforePickup: current.company.cargosCutoffMinutesBeforePickup,
          customerId: current.customerId,
          rentalAgreement: current.rentalAgreement ? { status: current.rentalAgreement.status } : null,
          cargosHandoverOverrideAt: current.cargosHandoverOverrideAt,
          cargosSubmissions: current.cargosSubmissions,
        },
        idCount,
        {
          cargosInScope: current.company.cargosInScope,
          cargosAdapter: current.company.cargosAdapter,
        },
        overrideIntent,
      );
    }
    if (nextStatus === 'COMPLETED' && current.status !== 'COMPLETED') {
      const effOdo = data.odometerInKm !== undefined ? data.odometerInKm : current.odometerInKm;
      const effFuel = data.fuelInPercent !== undefined ? data.fuelInPercent : current.fuelInPercent;
      const effRetCl =
        data.returnChecklist !== undefined ? data.returnChecklist : current.returnChecklistJson;
      assertReturnCompletionGates({
        odometerInKm: effOdo ?? null,
        fuelInPercent: effFuel ?? null,
        returnChecklistJson: effRetCl,
      });
    }
    const extraLinesTouched = data.extraLines !== undefined;
    const pricingTouched =
      data.vehicleId !== undefined ||
      data.pickupAt !== undefined ||
      data.returnAt !== undefined ||
      data.pickupStationId !== undefined ||
      data.returnStationId !== undefined;
    const nextExtraLinesForTotal =
      data.extraLines === undefined
        ? current.extraLines
        : data.extraLines === null
          ? []
          : data.extraLines;
    const shouldRecalc =
      data.totalCents === undefined && (extraLinesTouched || pricingTouched);
    if (data.totalCents !== undefined) {
      d.totalCents = data.totalCents;
    } else if (shouldRecalc) {
      d.totalCents = await this.computeAutoTotalCents({
        companyId,
        vehicleId,
        pickupAt: pickup,
        returnAt: ret,
        pickupStationId: pickupSt,
        returnStationId: returnSt,
        extraLines: nextExtraLinesForTotal,
      });
    }
    if (Object.keys(d).length === 0 && !extraLinesTouched) {
      return this.getOne(id, user);
    }
    if (!extraLinesTouched) {
      const updated = await this.prisma.reservation.update({
        where: { id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: d as any,
        include: {
          vehicle: { include: { vehicleClass: true } },
          pickupStation: { select: { id: true, name: true, code: true } },
          returnStation: { select: { id: true, name: true, code: true } },
          extraLines: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      const sync = odometerSyncFromUpdated(updated);
      await this.syncVehicleOdometerIfCompleted(
        this.prisma,
        sync.vehicleId,
        sync.status,
        sync.odometerInKm,
      );
      await this.logReservationUpdate(user, id, d, extraLinesTouched, sync);
      await this.logCargosHandoverOverrideAudit(data, user, id);
      this.queueReservationConfirmedEmailIfNeeded(current.status, updated);
      this.maybeEnqueuePartnerStatusWebhookAfterStaffUpdate(
        {
          id: current.id,
          source: current.source,
          status: current.status,
          createdByPartnerApiKeyId: current.createdByPartnerApiKeyId,
        },
        updated.status,
      );
      return this.getOne(id, user);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.reservationExtraLine.deleteMany({ where: { reservationId: id } });
      if (data.extraLines && data.extraLines.length > 0) {
        await tx.reservationExtraLine.createMany({
          data: data.extraLines.map((e, i) => ({
            reservationId: id,
            label: e.label,
            amountCents: e.amountCents,
            sortOrder: i,
          })),
        });
      }
      const updated = await tx.reservation.update({
        where: { id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: d as any,
        include: {
          vehicle: { include: { vehicleClass: true } },
          pickupStation: { select: { id: true, name: true, code: true } },
          returnStation: { select: { id: true, name: true, code: true } },
          extraLines: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      const sync = odometerSyncFromUpdated(updated);
      await this.syncVehicleOdometerIfCompleted(tx, sync.vehicleId, sync.status, sync.odometerInKm);
      await this.logReservationUpdate(user, id, d, extraLinesTouched, sync);
      await this.logCargosHandoverOverrideAudit(data, user, id);
      this.queueReservationConfirmedEmailIfNeeded(current.status, updated);
      this.maybeEnqueuePartnerStatusWebhookAfterStaffUpdate(
        {
          id: current.id,
          source: current.source,
          status: current.status,
          createdByPartnerApiKeyId: current.createdByPartnerApiKeyId,
        },
        updated.status,
      );
      return this.getOne(id, user);
    });
  }

  /** G2: when desk changes reservation status on a PARTNER booking, notify the creating API key (if known). */
  private maybeEnqueuePartnerStatusWebhookAfterStaffUpdate(
    before: {
      id: string;
      source: string;
      status: string;
      createdByPartnerApiKeyId: string | null;
    },
    newStatus: string,
  ): void {
    if (before.source !== 'PARTNER' || !before.createdByPartnerApiKeyId) {
      return;
    }
    if (before.status === newStatus) {
      return;
    }
    void this.partnerWebhook.enqueueReservationStatusChanged(
      before.createdByPartnerApiKeyId,
      before.id,
      before.status,
    );
  }

  private async logCargosHandoverOverrideAudit(
    data: UpdateReservationInput,
    user: JwtUser,
    reservationId: string,
  ): Promise<void> {
    if (data.cargosHandoverOverride === undefined) {
      return;
    }
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.cargos_handover_override',
      entity: 'Reservation',
      entityId: reservationId,
      metadata: {
        cleared: data.cargosHandoverOverride === null,
        hasReason: data.cargosHandoverOverride !== null,
      },
    });
  }

  private async logReservationUpdate(
    user: JwtUser,
    reservationId: string,
    patch: Record<string, unknown>,
    extraLinesTouched: boolean,
    updated: { status: string; odometerInKm: number | null; vehicleId: string },
  ): Promise<void> {
    const changedFields: string[] = Object.keys(patch);
    if (extraLinesTouched) {
      changedFields.push('extraLines');
    }
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.update',
      entity: 'Reservation',
      entityId: reservationId,
      metadata: {
        changedFields,
        status: updated.status,
        vehicleOdometerSynced: updated.status === 'COMPLETED' && updated.odometerInKm != null,
      },
    });
  }

  /** C2: email guest when desk moves booking to CONFIRMED (Stripe webhook path uses a separate payment email). */
  private queueReservationConfirmedEmailIfNeeded(
    previousStatus: string,
    row: {
      id: string;
      status: string;
      customerEmail: string;
      customerName: string;
      companyId: string;
      publicViewToken: string | null;
      pickupAt: Date;
      returnAt: Date;
      totalCents: number | null;
      currency: string;
    },
  ): void {
    if (previousStatus === 'CONFIRMED' || row.status !== 'CONFIRMED') {
      return;
    }
    if (!this.mail.isEnabled()) {
      return;
    }
    void this.mail
      .sendReservationConfirmedEmail({
        to: row.customerEmail,
        customerName: row.customerName,
        reservationId: row.id,
        companyId: row.companyId,
        totalCents: row.totalCents,
        currency: row.currency || 'EUR',
        pickupAt: row.pickupAt,
        returnAt: row.returnAt,
        publicViewToken: row.publicViewToken,
      })
      .catch((err) => {
        this.logger.warn(
          `Reservation confirmed mail failed (${row.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private async syncVehicleOdometerIfCompleted(
    db: Pick<PrismaClient, 'vehicle'>,
    vehicleId: string,
    status: string,
    odometerInKm: number | null,
  ) {
    if (status !== 'COMPLETED' || odometerInKm == null) {
      return;
    }
    await db.vehicle.update({
      where: { id: vehicleId },
      data: { odometerKm: odometerInKm },
    });
  }

  /** Hard-delete only in QUOTE; use PATCH status=CANCELLED for others */
  async removeDraft(id: string, user: JwtUser) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${id}`);
    }
    assertSameCompany(user, r.companyId, `Reservation not found: ${id}`);
    assertAgentReservationInScope(
      user,
      r.pickupStationId,
      r.returnStationId,
      `Reservation not found: ${id}`,
    );
    if (r.status !== 'QUOTE') {
      throw new ForbiddenException('Only QUOTE reservations can be deleted; set status to CANCELLED instead');
    }
    try {
      await this.prisma.reservation.delete({ where: { id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`Reservation not found: ${id}`);
      }
      throw e;
    }
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.delete_draft',
      entity: 'Reservation',
      entityId: id,
      metadata: { wasStatus: r.status, companyId: r.companyId },
    });
  }

  /**
   * B4 / B1: upsert `Customer` on public quote; validate `privacyNoticeVersion` when the company register is non-empty.
   * Does not link reservations to anonymized profiles (returns null).
   */
  private b4AuditSnapshot(row: {
    privacyNoticeVersion: string | null;
    privacyNoticeAcceptedAt: Date | null;
    marketingEmailOptIn: boolean;
    marketingOptInAt: Date | null;
  }) {
    return {
      privacyNoticeVersion: row.privacyNoticeVersion,
      privacyNoticeAcceptedAt: row.privacyNoticeAcceptedAt?.toISOString() ?? null,
      marketingEmailOptIn: row.marketingEmailOptIn,
      marketingOptInAt: row.marketingOptInAt?.toISOString() ?? null,
    };
  }

  private async upsertCustomerFromPublicQuote(
    companyId: string,
    contact: { name: string; email: string; phone: string },
    opts: { privacyNoticeVersion?: string; marketingEmailOptIn: boolean },
    auditCtx: { ip?: string; userAgent?: string },
  ): Promise<string | null> {
    const email = contact.email.trim().toLowerCase();
    const name = contact.name.trim();
    const phone = contact.phone.trim();

    const notices = await this.prisma.companyPrivacyNotice.findMany({
      where: { companyId },
      select: { version: true },
    });
    const requirePrivacy = notices.length > 0;
    const versionTrim = opts.privacyNoticeVersion?.trim();
    if (requirePrivacy) {
      if (!versionTrim || !notices.some((n) => n.version === versionTrim)) {
        throw new BadRequestException(
          'Privacy notice version is required and must match the company register (B4).',
        );
      }
    }

    const existing = await this.prisma.customer.findUnique({
      where: { companyId_email: { companyId, email } },
    });
    if (existing?.anonymizedAt) {
      return null;
    }

    const now = new Date();

    const emptyB4Row = {
      privacyNoticeVersion: null as string | null,
      privacyNoticeAcceptedAt: null as Date | null,
      marketingEmailOptIn: false,
      marketingOptInAt: null as Date | null,
    };

    if (!existing) {
      const createData: Prisma.CustomerCreateInput = {
        company: { connect: { id: companyId } },
        email,
        name,
        phone,
        marketingEmailOptIn: opts.marketingEmailOptIn,
        marketingOptInAt: opts.marketingEmailOptIn ? now : null,
      };
      if (requirePrivacy && versionTrim) {
        createData.privacyNoticeVersion = versionTrim;
        createData.privacyNoticeAcceptedAt = now;
      }
      const created = await this.prisma.customer.create({ data: createData });
      const beforeSnap = this.b4AuditSnapshot(emptyB4Row);
      const afterSnap = this.b4AuditSnapshot(created);
      if (JSON.stringify(beforeSnap) !== JSON.stringify(afterSnap)) {
        await this.audit.log({
          userId: null,
          action: 'customer.b4_public_quote',
          entity: 'Customer',
          entityId: created.id,
          metadata: { companyId, source: 'public_web', before: beforeSnap, after: afterSnap },
          ip: auditCtx.ip ?? null,
          userAgent: auditCtx.userAgent ?? null,
        });
      }
      return created.id;
    }

    const updateData: Prisma.CustomerUpdateInput = {
      name,
      phone,
    };
    if (opts.marketingEmailOptIn) {
      updateData.marketingEmailOptIn = true;
      updateData.marketingOptInAt =
        existing.marketingEmailOptIn && existing.marketingOptInAt ? existing.marketingOptInAt : now;
    } else {
      updateData.marketingEmailOptIn = false;
      updateData.marketingOptInAt = null;
    }
    if (requirePrivacy && versionTrim) {
      if (existing.privacyNoticeVersion !== versionTrim || !existing.privacyNoticeAcceptedAt) {
        updateData.privacyNoticeVersion = versionTrim;
        updateData.privacyNoticeAcceptedAt = now;
      }
    }

    const beforeSnap = this.b4AuditSnapshot(existing);
    const updated = await this.prisma.customer.update({
      where: { id: existing.id },
      data: updateData,
    });
    const afterSnap = this.b4AuditSnapshot(updated);
    if (JSON.stringify(beforeSnap) !== JSON.stringify(afterSnap)) {
      await this.audit.log({
        userId: null,
        action: 'customer.b4_public_quote',
        entity: 'Customer',
        entityId: existing.id,
        metadata: { companyId, source: 'public_web', before: beforeSnap, after: afterSnap },
        ip: auditCtx.ip ?? null,
        userAgent: auditCtx.userAgent ?? null,
      });
    }
    return updated.id;
  }

  /** Snapshot fields on the reservation; optional per-field overrides when `customerId` is set. */
  private async resolveCustomerContactForCreate(data: CreateReservationInput): Promise<{
    customerId: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
  }> {
    if (data.customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: data.customerId, companyId: data.companyId },
      });
      if (!c) {
        throw new NotFoundException('Customer not found for this company');
      }
      return {
        customerId: c.id,
        customerName: (data.customerName ?? c.name).trim(),
        customerEmail: (data.customerEmail ?? c.email).trim().toLowerCase(),
        customerPhone: (data.customerPhone ?? c.phone).trim(),
      };
    }
    return {
      customerId: null,
      customerName: data.customerName!.trim(),
      customerEmail: data.customerEmail!.trim().toLowerCase(),
      customerPhone: data.customerPhone!.trim(),
    };
  }

  /** If `totalCents` omitted, use class daily × days + one-way + sum(extra lines). */
  private async resolveTotalCents(data: CreateReservationInput): Promise<number | null> {
    if (data.totalCents !== undefined) {
      return data.totalCents;
    }
    return this.computeAutoTotalCents({
      companyId: data.companyId,
      vehicleId: data.vehicleId,
      pickupAt: data.pickupAt,
      returnAt: data.returnAt,
      pickupStationId: data.pickupStationId,
      returnStationId: data.returnStationId,
      extraLines: data.extraLines ?? [],
    });
  }

  private async computeAutoTotalCents(args: {
    companyId: string;
    vehicleId: string;
    pickupAt: Date;
    returnAt: Date;
    pickupStationId: string;
    returnStationId: string;
    extraLines: { amountCents: number }[];
  }): Promise<number | null> {
    const { companyId, vehicleId, pickupAt, returnAt, pickupStationId, returnStationId, extraLines } = args;
    const v = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        vehicleClass: {
          select: {
            defaultDailyCents: true,
            seasonalRates: { select: { validFrom: true, validTo: true, dailyCents: true, priority: true } },
          },
        },
      },
    });
    if (!v) {
      return null;
    }
    let rentCents: number | null;
    if (v.rentPricingMode === 'FLAT_TRIP') {
      rentCents = v.flatTripRentCents;
    } else if (v.rentPricingMode === 'FIXED_DAILY') {
      const d = v.rentOverrideDailyCents;
      rentCents = d == null ? null : d * countRentalDays24h(pickupAt, returnAt);
    } else {
      const daily = v.vehicleClass.defaultDailyCents;
      rentCents = sumClassRentCents24h(daily, v.vehicleClass.seasonalRates, pickupAt, returnAt);
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { oneWayFeeCents: true },
    });
    const oneWay =
      pickupStationId !== returnStationId ? (company?.oneWayFeeCents ?? 0) : 0;
    const extraSum = extraLines.reduce((s, e) => s + e.amountCents, 0);
    if (rentCents == null) {
      return oneWay + extraSum > 0 ? oneWay + extraSum : null;
    }
    return rentCents + oneWay + extraSum;
  }

  private assertTimeOrder(pickup: Date, end: Date) {
    if (pickup >= end) {
      throw new BadRequestException('returnAt must be after pickupAt');
    }
  }

  private async assertCompanyCoherent(data: {
    companyId: string;
    vehicleId: string;
    pickupStationId: string;
    returnStationId: string;
  }) {
    const [vehicle, pickup, ret] = await Promise.all([
      this.prisma.vehicle.findUnique({ where: { id: data.vehicleId } }),
      this.prisma.station.findUnique({ where: { id: data.pickupStationId } }),
      this.prisma.station.findUnique({ where: { id: data.returnStationId } }),
    ]);
    if (!vehicle) {
      throw new NotFoundException(`Vehicle not found: ${data.vehicleId}`);
    }
    if (!pickup || !ret) {
      throw new NotFoundException('Pickup or return station not found');
    }
    if (vehicle.companyId !== data.companyId) {
      throw new BadRequestException('Vehicle does not belong to this company');
    }
    if (pickup.companyId !== data.companyId || ret.companyId !== data.companyId) {
      throw new BadRequestException('Stations must belong to the same company as the reservation');
    }
  }

  private async assertVehicleFree(vehicleId: string, from: Date, to: Date, excludeId?: string) {
    await this.assertVehicleFreeTx(this.prisma, vehicleId, from, to, excludeId);
  }

  private async assertVehicleFreeTx(
    tx: Prisma.TransactionClient,
    vehicleId: string,
    from: Date,
    to: Date,
    excludeId?: string,
  ) {
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle not found: ${vehicleId}`);
    }
    if (vehicle.status === 'MAINTENANCE' || vehicle.status === 'OUT_OF_FLEET') {
      throw new ConflictException('Vehicle is not available for rental (fleet status)');
    }
    const blocks = await tx.calendarBlock.findMany({ where: { vehicleId } });
    for (const b of blocks) {
      if (halfOpenRangesOverlap(from, to, b.startsAt, b.endsAt)) {
        throw new ConflictException('Rental window overlaps a calendar block (e.g. maintenance) on this vehicle');
      }
    }
    const clash = await tx.reservation.findFirst({
      where: {
        vehicleId,
        id: excludeId ? { not: excludeId } : undefined,
        status: ACTIVE_STATUS_FILTER,
        AND: [{ pickupAt: { lt: to } }, { returnAt: { gt: from } }],
      },
    });
    if (clash) {
      throw new ConflictException(
        `Vehicle already has an active reservation in this period (${clash.id})`,
      );
    }
  }
}
