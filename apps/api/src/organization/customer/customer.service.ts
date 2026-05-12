import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnonymizeCustomerBody,
  CreateCustomerInput,
  UpdateCustomerInput,
  isValidItalianFiscalCode,
  isValidItalianVatNumber,
  normalizeItalianVatDigits,
} from '@car-rental/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../../prisma/prisma-errors';
import { JwtUser } from '../../auth/types';
import {
  assertCreateBodyCompanyId,
  assertSameCompany,
  effectiveListCompanyFilter,
} from '../../auth/company-access';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static trimOrNull(s: string | null | undefined): string | null {
    if (s == null) return null;
    const t = s.trim();
    return t ? t : null;
  }

  /** B4: JSON-safe consent fields for audit + export (no PII). */
  private static b4ConsentSnapshot(row: {
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

  findAll(
    companyId: string | undefined,
    q: string | undefined,
    user: JwtUser,
    opts?: { ocrPending?: boolean },
  ) {
    const f = effectiveListCompanyFilter(user, companyId);
    const where: Prisma.CustomerWhereInput = { ...(Object.keys(f).length ? f : {}) };
    const trimmed = q?.trim();
    if (trimmed) {
      const qi = { contains: trimmed, mode: 'insensitive' as const };
      where.OR = [
        { name: qi },
        { email: qi },
        { phone: { contains: trimmed } },
        { fiscalCode: qi },
        { vatNumber: { contains: trimmed } },
        { sdiRecipientCode: { contains: trimmed, mode: 'insensitive' as const } },
        { pec: qi },
      ];
    }
    if (opts?.ocrPending) {
      where.documents = {
        some: {
          ocrStatus: 'PENDING',
          uploadCompletedAt: { not: null },
          ocrAppliedAt: null,
        },
      };
    }
    return this.prisma.customer.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      include: { _count: { select: { reservations: true } } },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const agentReservationScope =
      user.role === 'AGENT' && user.stationId
        ? { OR: [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }] }
        : undefined;
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            reservations: agentReservationScope
              ? { where: agentReservationScope }
              : true,
          },
        },
        reservations: {
          ...(agentReservationScope ? { where: agentReservationScope } : {}),
          orderBy: { pickupAt: 'desc' },
          take: 25,
          select: {
            id: true,
            status: true,
            source: true,
            pickupAt: true,
            returnAt: true,
            totalCents: true,
            currency: true,
            vehicle: {
              select: {
                licensePlate: true,
                vehicleClass: { select: { name: true, code: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(`Customer not found: ${id}`);
    }
    assertSameCompany(user, row.companyId, `Customer not found: ${id}`);
    const { reservations: recentReservations, ...rest } = row;
    return { ...rest, recentReservations };
  }

  /**
   * B1: paginated rental history for desk (newest pickup first). **AGENT** scope matches `findOne` / reservations list.
   */
  async listReservations(
    customerId: string,
    user: JwtUser,
    opts: { limit: number; offset: number },
  ): Promise<{
    items: Array<{
      id: string;
      status: string;
      source: string;
      pickupAt: Date;
      returnAt: Date;
      totalCents: number | null;
      currency: string;
      vehicle: {
        licensePlate: string;
        vehicleClass: { name: string; code: string };
      };
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const { limit, offset } = opts;
    const cust = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyId: true },
    });
    if (!cust) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    assertSameCompany(user, cust.companyId, `Customer not found: ${customerId}`);

    const agentReservationScope =
      user.role === 'AGENT' && user.stationId
        ? { OR: [{ pickupStationId: user.stationId }, { returnStationId: user.stationId }] }
        : undefined;

    const where: Prisma.ReservationWhereInput = {
      customerId,
      ...(agentReservationScope ?? {}),
    };

    const select = {
      id: true,
      status: true,
      source: true,
      pickupAt: true,
      returnAt: true,
      totalCents: true,
      currency: true,
      vehicle: {
        select: {
          licensePlate: true,
          vehicleClass: { select: { name: true, code: true } },
        },
      },
    } as const;

    const [total, rows] = await Promise.all([
      this.prisma.reservation.count({ where }),
      this.prisma.reservation.findMany({
        where,
        orderBy: { pickupAt: 'desc' },
        skip: offset,
        take: limit,
        select,
      }),
    ]);

    return { items: rows, total, limit, offset };
  }

  /**
   * B1: merge duplicate CRM profile — all reservations + KYC documents move to `intoCustomerId`; `fromCustomerId` deleted.
   */
  async mergeInto(fromCustomerId: string, intoCustomerId: string, user: JwtUser) {
    if (fromCustomerId === intoCustomerId) {
      throw new BadRequestException('Cannot merge a customer record into itself');
    }

    const [from, into] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: fromCustomerId },
        select: { companyId: true, anonymizedAt: true },
      }),
      this.prisma.customer.findUnique({
        where: { id: intoCustomerId },
        select: { companyId: true, anonymizedAt: true },
      }),
    ]);
    if (!from) {
      throw new NotFoundException(`Customer not found: ${fromCustomerId}`);
    }
    if (!into) {
      throw new NotFoundException(`Customer not found: ${intoCustomerId}`);
    }
    assertSameCompany(user, from.companyId, `Customer not found: ${fromCustomerId}`);
    assertSameCompany(user, into.companyId, `Customer not found: ${intoCustomerId}`);
    if (from.companyId !== into.companyId) {
      throw new BadRequestException('Merge is only allowed between customers of the same company');
    }
    if (from.anonymizedAt != null || into.anonymizedAt != null) {
      throw new BadRequestException('Cannot merge anonymized customer records');
    }

    const { reservationsMoved, documentsMoved } = await this.prisma.$transaction(async (tx) => {
      const r = await tx.reservation.updateMany({
        where: { customerId: fromCustomerId },
        data: { customerId: intoCustomerId },
      });
      const d = await tx.customerDocument.updateMany({
        where: { customerId: fromCustomerId },
        data: { customerId: intoCustomerId },
      });
      await tx.customer.delete({ where: { id: fromCustomerId } });
      return { reservationsMoved: r.count, documentsMoved: d.count };
    });

    await this.audit.log({
      userId: user.sub,
      action: 'customer.merge',
      entity: 'Customer',
      entityId: intoCustomerId,
      metadata: {
        companyId: into.companyId,
        fromCustomerId,
        intoCustomerId,
        reservationsMoved,
        documentsMoved,
      },
    });

    return {
      ok: true as const,
      fromCustomerId,
      intoCustomerId,
      reservationsMoved,
      documentsMoved,
    };
  }

  /**
   * B1: detect duplicate email within the same company before create / email change (desk UX).
   * Returns at most one match; excludes the current customer when `excludeCustomerId` is set (edit flow).
   */
  async lookupByEmail(
    companyId: string,
    emailNormalized: string,
    excludeCustomerId: string | undefined,
    user: JwtUser,
  ): Promise<{ match: { id: string; name: string; email: string; phone: string } | null }> {
    const f = effectiveListCompanyFilter(user, companyId);
    if (!('companyId' in f) || !f.companyId) {
      throw new BadRequestException('companyId is required');
    }
    const cid = f.companyId;
    const row = await this.prisma.customer.findFirst({
      where: {
        companyId: cid,
        email: emailNormalized,
        ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
      },
      select: { id: true, name: true, email: true, phone: true },
    });
    return { match: row };
  }

  /**
   * B1: duplicate codice fiscale hint — compares stripped + uppercased value so spaced forms still match.
   */
  async lookupByFiscalCode(
    companyId: string,
    fiscalCodeRaw: string,
    excludeCustomerId: string | undefined,
    user: JwtUser,
  ): Promise<{ match: { id: string; name: string; email: string; phone: string } | null }> {
    const f = effectiveListCompanyFilter(user, companyId);
    if (!('companyId' in f) || !f.companyId) {
      throw new BadRequestException('companyId is required');
    }
    const cid = f.companyId;
    const key = fiscalCodeRaw.trim().toUpperCase().replace(/\s/g, '');
    if (key.length !== 16 || !isValidItalianFiscalCode(key)) {
      return { match: null };
    }
    type Row = { id: string; name: string; email: string; phone: string };
    const rows = excludeCustomerId
      ? await this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT id, name, email, phone
          FROM "Customer"
          WHERE "companyId" = ${cid}::uuid
            AND "fiscalCode" IS NOT NULL
            AND id <> ${excludeCustomerId}::uuid
            AND UPPER(REPLACE("fiscalCode", ' ', '')) = ${key}
          LIMIT 1
        `)
      : await this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT id, name, email, phone
          FROM "Customer"
          WHERE "companyId" = ${cid}::uuid
            AND "fiscalCode" IS NOT NULL
            AND UPPER(REPLACE("fiscalCode", ' ', '')) = ${key}
          LIMIT 1
        `);
    return { match: rows[0] ?? null };
  }

  /**
   * B1: duplicate Partita IVA hint — matches 11-digit form and IT + 11 digits (case-insensitive).
   */
  async lookupByVatNumber(
    companyId: string,
    vatRaw: string,
    excludeCustomerId: string | undefined,
    user: JwtUser,
  ): Promise<{ match: { id: string; name: string; email: string; phone: string } | null }> {
    const f = effectiveListCompanyFilter(user, companyId);
    if (!('companyId' in f) || !f.companyId) {
      throw new BadRequestException('companyId is required');
    }
    const cid = f.companyId;
    const tr = vatRaw.trim();
    if (!tr) {
      return { match: null };
    }
    const digits = normalizeItalianVatDigits(tr);
    if (!digits || !isValidItalianVatNumber(tr)) {
      return { match: null };
    }
    const row = await this.prisma.customer.findFirst({
      where: {
        companyId: cid,
        ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
        vatNumber: { not: null },
        OR: [
          { vatNumber: { equals: digits, mode: 'insensitive' } },
          { vatNumber: { equals: `IT${digits}`, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true },
    });
    return { match: row };
  }

  /**
   * B1: duplicate phone hint — compares digits-only so spacing/country-prefix forms still match.
   */
  async lookupByPhone(
    companyId: string,
    phoneRaw: string,
    excludeCustomerId: string | undefined,
    user: JwtUser,
  ): Promise<{ match: { id: string; name: string; email: string; phone: string } | null }> {
    const f = effectiveListCompanyFilter(user, companyId);
    if (!('companyId' in f) || !f.companyId) {
      throw new BadRequestException('companyId is required');
    }
    const cid = f.companyId;
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      return { match: null };
    }
    type Row = { id: string; name: string; email: string; phone: string };
    const rows = excludeCustomerId
      ? await this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT id, name, email, phone
          FROM "Customer"
          WHERE "companyId" = ${cid}::uuid
            AND regexp_replace(phone, '[^0-9]', '', 'g') = ${digits}
            AND id <> ${excludeCustomerId}::uuid
          LIMIT 1
        `)
      : await this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT id, name, email, phone
          FROM "Customer"
          WHERE "companyId" = ${cid}::uuid
            AND regexp_replace(phone, '[^0-9]', '', 'g') = ${digits}
          LIMIT 1
        `);
    return { match: rows[0] ?? null };
  }

  async create(data: CreateCustomerInput, user: JwtUser) {
    assertCreateBodyCompanyId(user, data.companyId);
    const company = await this.prisma.company.findUnique({ where: { id: data.companyId } });
    if (!company) {
      throw new NotFoundException(`Company not found: ${data.companyId}`);
    }
    try {
      return await this.prisma.customer.create({
        data: {
          companyId: data.companyId,
          name: data.name.trim(),
          email: data.email,
          phone: data.phone.trim(),
          notes: data.notes?.trim() || null,
          fiscalCode:
            data.fiscalCode == null ? null : CustomerService.trimOrNull(data.fiscalCode),
          vatNumber: data.vatNumber == null ? null : CustomerService.trimOrNull(data.vatNumber),
          sdiRecipientCode:
            data.sdiRecipientCode == null
              ? null
              : (() => {
                  const t = CustomerService.trimOrNull(data.sdiRecipientCode);
                  return t ? t.toUpperCase() : null;
                })(),
          pec:
            data.pec == null
              ? null
              : (() => {
                  const t = CustomerService.trimOrNull(data.pec);
                  return t ? t.toLowerCase() : null;
                })(),
        },
        include: { _count: { select: { reservations: true } } },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A customer with this email already exists for this company');
      }
      throw e;
    }
  }

  async update(id: string, data: UpdateCustomerInput, user: JwtUser) {
    const row = await this.findOne(id, user);
    if (row.anonymizedAt) {
      throw new BadRequestException('Cannot update an anonymized customer (B4)');
    }
    if (
      data.name === undefined &&
      data.email === undefined &&
      data.phone === undefined &&
      data.notes === undefined &&
      data.fiscalCode === undefined &&
      data.vatNumber === undefined &&
      data.sdiRecipientCode === undefined &&
      data.pec === undefined &&
      data.privacyNoticeVersion === undefined &&
      data.privacyNoticeAcceptedAt === undefined &&
      data.marketingEmailOptIn === undefined &&
      data.marketingOptInAt === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }
    const patch: Prisma.CustomerUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.email !== undefined) patch.email = data.email;
    if (data.phone !== undefined) patch.phone = data.phone.trim();
    if (data.notes !== undefined) {
      patch.notes = data.notes === null || data.notes === '' ? null : data.notes;
    }
    if (data.fiscalCode !== undefined) {
      patch.fiscalCode = data.fiscalCode === null ? null : CustomerService.trimOrNull(data.fiscalCode);
    }
    if (data.vatNumber !== undefined) {
      patch.vatNumber = data.vatNumber === null ? null : CustomerService.trimOrNull(data.vatNumber);
    }
    if (data.sdiRecipientCode !== undefined) {
      patch.sdiRecipientCode =
        data.sdiRecipientCode === null
          ? null
          : (() => {
              const t = CustomerService.trimOrNull(data.sdiRecipientCode);
              return t ? t.toUpperCase() : null;
            })();
    }
    if (data.pec !== undefined) {
      patch.pec =
        data.pec === null
          ? null
          : (() => {
              const t = CustomerService.trimOrNull(data.pec);
              return t ? t.toLowerCase() : null;
            })();
    }
    if (data.privacyNoticeVersion !== undefined) {
      patch.privacyNoticeVersion = data.privacyNoticeVersion;
    }
    if (data.privacyNoticeAcceptedAt !== undefined) {
      patch.privacyNoticeAcceptedAt = data.privacyNoticeAcceptedAt
        ? new Date(data.privacyNoticeAcceptedAt)
        : null;
    } else if (data.privacyNoticeVersion !== undefined && data.privacyNoticeVersion) {
      patch.privacyNoticeAcceptedAt = new Date();
    }
    if (data.marketingEmailOptIn !== undefined) {
      patch.marketingEmailOptIn = data.marketingEmailOptIn;
      if (data.marketingEmailOptIn) {
        patch.marketingOptInAt = data.marketingOptInAt ? new Date(data.marketingOptInAt) : new Date();
      } else {
        patch.marketingOptInAt = null;
      }
    } else if (data.marketingOptInAt !== undefined) {
      patch.marketingOptInAt = data.marketingOptInAt ? new Date(data.marketingOptInAt) : null;
    }
    const b4PatchRequested =
      data.privacyNoticeVersion !== undefined ||
      data.privacyNoticeAcceptedAt !== undefined ||
      data.marketingEmailOptIn !== undefined ||
      data.marketingOptInAt !== undefined;
    const beforeB4 = CustomerService.b4ConsentSnapshot(row);
    try {
      const updated = await this.prisma.customer.update({
        where: { id: row.id },
        data: patch,
        include: { _count: { select: { reservations: true } } },
      });
      if (b4PatchRequested) {
        const afterB4 = CustomerService.b4ConsentSnapshot(updated);
        if (JSON.stringify(beforeB4) !== JSON.stringify(afterB4)) {
          await this.audit.log({
            userId: user.sub,
            action: 'customer.b4_consent_update',
            entity: 'Customer',
            entityId: id,
            metadata: { companyId: row.companyId, before: beforeB4, after: afterB4 },
          });
        }
      }
      return updated;
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A customer with this email already exists for this company');
      }
      throw e;
    }
  }

  async remove(id: string, user: JwtUser) {
    await this.findOne(id, user);
    await this.prisma.customer.delete({ where: { id } });
  }

  /** B4: portable JSON for data subject / DPO review — no binary document payloads */
  async exportGdprPackage(id: string, user: JwtUser) {
    const row = await this.findOne(id, user);
    const { recentReservations: _deskSlice, ...customerSnapshot } = row;
    const [reservations, documents, companyPrivacyNoticeRegister] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          source: true,
          totalCents: true,
          currency: true,
          paidAt: true,
          pickupAt: true,
          returnAt: true,
          createdAt: true,
          companyId: true,
        },
      }),
      this.prisma.customerDocument.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          docType: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          retentionUntil: true,
          verifiedAt: true,
          verifiedByUserId: true,
        },
      }),
      this.prisma.companyPrivacyNotice.findMany({
        where: { companyId: row.companyId },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'asc' }],
        select: {
          version: true,
          policyUrl: true,
          effectiveFrom: true,
          notes: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      exportKind: 'customer_gdpr_v1' as const,
      exportedAt: new Date().toISOString(),
      /** B4: explicit consent block for DPO workflows (also on `customer`, kept stable for tooling). */
      b4: {
        privacyNoticeVersion: customerSnapshot.privacyNoticeVersion,
        privacyNoticeAcceptedAt: customerSnapshot.privacyNoticeAcceptedAt,
        marketingEmailOptIn: customerSnapshot.marketingEmailOptIn,
        marketingOptInAt: customerSnapshot.marketingOptInAt,
        anonymizedAt: customerSnapshot.anonymizedAt,
      },
      /** B4: company register at export time (reference for notice versions; not legal proof). */
      companyPrivacyNoticeRegister,
      customer: customerSnapshot,
      reservations,
      documents,
    };
  }

  async anonymize(id: string, body: AnonymizeCustomerBody, user: JwtUser) {
    if (user.role === 'AGENT' || user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Only admin or branch manager can anonymize a customer');
    }
    const row = await this.findOne(id, user);
    if (row.anonymizedAt) {
      throw new BadRequestException('Customer is already anonymized');
    }
    const redactedEmail = `re-${row.id}@anonymized.invalid`;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: row.id },
        data: {
          name: 'Redacted',
          email: redactedEmail,
          phone: '—',
          notes: null,
          fiscalCode: null,
          vatNumber: null,
          sdiRecipientCode: null,
          pec: null,
          privacyNoticeVersion: null,
          privacyNoticeAcceptedAt: null,
          marketingEmailOptIn: false,
          marketingOptInAt: null,
          anonymizedAt: now,
        },
      }),
      this.prisma.reservation.updateMany({
        where: { customerId: row.id },
        data: {
          customerName: 'Redacted',
          customerEmail: redactedEmail,
          customerPhone: '—',
        },
      }),
    ]);
    await this.audit.log({
      userId: user.sub,
      action: 'customer.gdpr_anonymize',
      entity: 'Customer',
      entityId: id,
      metadata: { companyId: row.companyId, reason: body.reason?.slice(0, 200) },
    });
    return this.prisma.customer.findUniqueOrThrow({
      where: { id: row.id },
      include: { _count: { select: { reservations: true } } },
    });
  }
}
