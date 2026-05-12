import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoiceAmounts, CreateInvoiceInput, UpdateInvoiceInput } from '@car-rental/shared';
import { JwtUser } from '../auth/types';
import {
  assertCreateBodyCompanyId,
  assertSameCompany,
  effectiveListCompanyFilter,
} from '../auth/company-access';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../prisma/prisma-errors';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(
    companyId: string | undefined,
    filters: {
      q?: string | undefined;
      status?: 'DRAFT' | 'ISSUED' | 'VOID';
      kind?: 'INVOICE' | 'CREDIT_NOTE';
      reservationId?: string;
    },
    user: JwtUser,
  ) {
    const f = effectiveListCompanyFilter(user, companyId);
    const where: Prisma.InvoiceWhereInput = { ...(Object.keys(f).length ? f : {}) };
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.kind) {
      where.kind = filters.kind;
    }
    if (filters.reservationId) {
      where.reservationId = filters.reservationId;
    }
    const trimmed = filters.q?.trim();
    if (trimmed) {
      const Qi = { contains: trimmed, mode: 'insensitive' as const };
      where.OR = [{ documentNumber: Qi }, { description: Qi }];
    }
    return this.prisma.invoice.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        reservation: { select: { id: true, customerName: true } },
        creditedInvoice: { select: { id: true, documentNumber: true, kind: true, status: true } },
        sdiSubmissions: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const row = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            fiscalCode: true,
            vatNumber: true,
            sdiRecipientCode: true,
            pec: true,
          },
        },
        reservation: {
          select: {
            id: true,
            customerName: true,
            status: true,
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
                fiscalCode: true,
                vatNumber: true,
                sdiRecipientCode: true,
                pec: true,
              },
            },
          },
        },
        creditedInvoice: { select: { id: true, documentNumber: true, kind: true, status: true, totalCents: true } },
        creditingNotes: { select: { id: true, documentNumber: true, status: true, kind: true, totalCents: true } },
        sdiSubmissions: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) {
      throw new NotFoundException(`Invoice not found: ${id}`);
    }
    assertSameCompany(user, row.companyId, `Invoice not found: ${id}`);
    return row;
  }

  async create(data: CreateInvoiceInput, user: JwtUser) {
    assertCreateBodyCompanyId(user, data.companyId);
    const { vatCents, totalCents } = computeInvoiceAmounts(data.subtotalCents, data.vatRateBps);

    if (data.reservationId) {
      const res = await this.prisma.reservation.findUnique({ where: { id: data.reservationId } });
      if (!res) throw new NotFoundException(`Reservation not found: ${data.reservationId}`);
      if (res.companyId !== data.companyId) {
        throw new BadRequestException('Reservation belongs to a different company');
      }
    }

    if (data.kind === 'CREDIT_NOTE') {
      const orig = await this.prisma.invoice.findUnique({ where: { id: data.creditedInvoiceId! } });
      if (!orig) throw new NotFoundException('Credited invoice not found');
      if (orig.companyId !== data.companyId) {
        throw new BadRequestException('Credited invoice belongs to a different company');
      }
      if (orig.status !== 'ISSUED' || orig.kind !== 'INVOICE') {
        throw new BadRequestException('Can only issue credit notes against an ISSUED tax invoice');
      }
    }

    const inv = await this.prisma.invoice.create({
      data: {
        companyId: data.companyId,
        reservationId: data.reservationId,
        kind: data.kind,
        status: 'DRAFT',
        creditedInvoiceId: data.creditedInvoiceId,
        subtotalCents: data.subtotalCents,
        vatRateBps: data.vatRateBps,
        vatCents,
        totalCents,
        currency: data.currency,
        description: data.description?.trim() || null,
      },
      include: {
        reservation: { select: { id: true, customerName: true } },
        creditedInvoice: { select: { id: true, documentNumber: true, kind: true, status: true } },
        sdiSubmissions: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'invoice.create',
      entity: 'Invoice',
      entityId: inv.id,
      metadata: {
        companyId: data.companyId,
        kind: data.kind,
        status: 'DRAFT',
        ...(inv.reservationId ? { reservationId: inv.reservationId } : {}),
      },
    });
    return inv;
  }

  async update(id: string, data: UpdateInvoiceInput, user: JwtUser) {
    const row = await this.findOne(id, user);
    if (row.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT invoices can be updated');
    }
    if (data.reservationId !== undefined) {
      if (data.reservationId === null) {
        // ok, clear
      } else {
        const res = await this.prisma.reservation.findUnique({ where: { id: data.reservationId } });
        if (!res) throw new NotFoundException(`Reservation not found: ${data.reservationId}`);
        if (res.companyId !== row.companyId) {
          throw new BadRequestException('Reservation belongs to a different company');
        }
      }
    }
    if (
      data.subtotalCents === undefined &&
      data.vatRateBps === undefined &&
      data.currency === undefined &&
      data.description === undefined &&
      data.reservationId === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }

    const subtotalCents = data.subtotalCents ?? row.subtotalCents;
    const vatRateBps = data.vatRateBps ?? row.vatRateBps;
    const { vatCents, totalCents } = computeInvoiceAmounts(subtotalCents, vatRateBps);

    const patch: Prisma.InvoiceUpdateInput = {
      vatCents,
      totalCents,
    };
    if (data.subtotalCents !== undefined) patch.subtotalCents = data.subtotalCents;
    if (data.vatRateBps !== undefined) patch.vatRateBps = data.vatRateBps;
    if (data.currency !== undefined) patch.currency = data.currency;
    if (data.description !== undefined) {
      patch.description = data.description === null || data.description === '' ? null : data.description;
    }
    if (data.reservationId !== undefined) {
      patch.reservation = data.reservationId === null ? { disconnect: true } : { connect: { id: data.reservationId } };
    }

    return this.prisma.invoice.update({
      where: { id: row.id },
      data: patch,
      include: {
        reservation: { select: { id: true, customerName: true } },
        creditedInvoice: { select: { id: true, documentNumber: true, kind: true, status: true } },
        sdiSubmissions: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  /** Atomically assign fiscal number and mark ISSUED (non-SDI v1) */
  async issue(id: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed to issue invoices');
    }
    const year = new Date().getUTCFullYear();
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.invoice.findUnique({ where: { id } });
        if (!row) {
          throw new NotFoundException(`Invoice not found: ${id}`);
        }
        assertSameCompany(user, row.companyId, `Invoice not found: ${id}`);
        if (row.status !== 'DRAFT') {
          throw new BadRequestException('Only DRAFT documents can be issued');
        }
        if (row.kind === 'CREDIT_NOTE' && !row.creditedInvoiceId) {
          throw new BadRequestException('Credit note is missing credited invoice');
        }

        if (row.kind === 'CREDIT_NOTE' && row.creditedInvoiceId) {
          const orig = await tx.invoice.findUnique({
            where: { id: row.creditedInvoiceId },
          });
          if (!orig) {
            throw new BadRequestException('Credited invoice not found');
          }
          if (orig.companyId !== row.companyId) {
            throw new BadRequestException('Credited invoice belongs to a different company');
          }
          if (orig.status !== 'ISSUED' || orig.kind !== 'INVOICE') {
            throw new BadRequestException('Credit notes can only be issued against an ISSUED tax invoice');
          }
          const creditedSoFar = await tx.invoice.aggregate({
            where: {
              creditedInvoiceId: row.creditedInvoiceId,
              kind: 'CREDIT_NOTE',
              status: 'ISSUED',
            },
            _sum: { totalCents: true },
          });
          const used = creditedSoFar._sum.totalCents ?? 0;
          const remaining = orig.totalCents - used;
          if (row.totalCents > remaining) {
            const ref = orig.documentNumber ?? orig.id.slice(0, 8);
            throw new BadRequestException(
              `Credit note total (${row.totalCents} minor units) exceeds remaining creditable amount on ${ref} (${remaining} minor units left, incl. VAT)`,
            );
          }
        }

        const seqRows = await tx.$queryRaw<{ lastIssued: number }[]>`
          INSERT INTO "InvoiceFiscalSequence" ("companyId", "year", "lastIssued", "updatedAt")
          VALUES (${row.companyId}::text, ${year}::int, 1, NOW())
          ON CONFLICT ("companyId", "year")
          DO UPDATE SET
            "lastIssued" = "InvoiceFiscalSequence"."lastIssued" + 1,
            "updatedAt" = NOW()
          RETURNING "lastIssued" AS "lastIssued"
        `;
        const seq = seqRows[0]?.lastIssued;
        if (seq == null) {
          throw new ConflictException('Failed to reserve invoice number');
        }
        const documentNumber = `${year}/${String(seq).padStart(5, '0')}`;

        return tx.invoice.update({
          where: { id: row.id },
          data: {
            status: 'ISSUED',
            issueYear: year,
            issueSequence: seq,
            documentNumber,
            issuedAt: new Date(),
          },
          include: {
            reservation: { select: { id: true, customerName: true } },
            creditedInvoice: { select: { id: true, documentNumber: true, kind: true, status: true } },
            sdiSubmissions: { take: 1, orderBy: { createdAt: 'desc' } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ).then(async (out) => {
      await this.audit.log({
        userId: user.sub,
        action: 'invoice.issue',
        entity: 'Invoice',
        entityId: id,
        metadata: {
          documentNumber: out.documentNumber,
          companyId: out.companyId,
          ...(out.reservationId ? { reservationId: out.reservationId } : {}),
        },
      });
      return out;
    });
  }

  async void(id: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed to void invoices');
    }
    const row = await this.findOne(id, user);
    if (row.status !== 'ISSUED') {
      throw new BadRequestException('Only ISSUED documents can be voided');
    }
    const out = await this.prisma.invoice.update({
      where: { id: row.id },
      data: { status: 'VOID' },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'invoice.void',
      entity: 'Invoice',
      entityId: id,
      metadata: {
        documentNumber: row.documentNumber,
        companyId: row.companyId,
        ...(row.reservationId ? { reservationId: row.reservationId } : {}),
      },
    });
    return out;
  }

  async remove(id: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed to delete invoices');
    }
    const row = await this.findOne(id, user);
    if (row.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT invoices can be deleted');
    }
    try {
      await this.prisma.invoice.delete({ where: { id: row.id } });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BadRequestException('Cannot delete: referenced by a credit note draft');
      }
      throw e;
    }
    await this.audit.log({
      userId: user.sub,
      action: 'invoice.delete_draft',
      entity: 'Invoice',
      entityId: id,
      metadata: {
        companyId: row.companyId,
        ...(row.reservationId ? { reservationId: row.reservationId } : {}),
      },
    });
  }
}
