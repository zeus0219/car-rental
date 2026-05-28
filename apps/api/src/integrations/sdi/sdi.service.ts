import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SdiEnqueueBody, sdiCallbackBodySchema } from '@car-rental/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/types';
import { assertSameCompany, effectiveListCompanyFilter, isAdminCrossCompany } from '../../auth/company-access';
import { AuditService } from '../../audit/audit.service';

const HTTP_TIMEOUT_MS = 15_000;

type InvoiceForSdiHandoff = {
  id: string;
  companyId: string;
  documentNumber: string | null;
  description: string | null;
  kind: string;
  subtotalCents: number;
  vatRateBps: number;
  vatCents: number;
  totalCents: number;
  currency: string;
  issuedAt: Date | null;
  company: {
    name: string;
    fiscalCode: string | null;
    vatNumber: string | null;
    sdiRecipientCode: string | null;
    pec: string | null;
  };
  reservation: {
    customerName: string | null;
    customer: {
      name: string;
      email: string;
      fiscalCode: string | null;
      vatNumber: string | null;
      sdiRecipientCode: string | null;
      pec: string | null;
    } | null;
  } | null;
};

function buildSdiMiddlewareBody(
  submissionId: string,
  inv: InvoiceForSdiHandoff,
  opts: { callbackUrl: string | null },
) {
  const buyer =
    inv.reservation == null
      ? null
      : {
          displayName: inv.reservation.customer?.name ?? inv.reservation.customerName,
          email: inv.reservation.customer?.email ?? null,
          fiscalCode: inv.reservation.customer?.fiscalCode ?? null,
          vatNumber: inv.reservation.customer?.vatNumber ?? null,
          sdiRecipientCode: inv.reservation.customer?.sdiRecipientCode ?? null,
          pec: inv.reservation.customer?.pec ?? null,
        };

  return {
    submissionId,
    companyId: inv.companyId,
    invoiceId: inv.id,
    documentNumber: inv.documentNumber,
    description: inv.description,
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    subtotalCents: inv.subtotalCents,
    vatRateBps: inv.vatRateBps,
    vatCents: inv.vatCents,
    totalCents: inv.totalCents,
    currency: inv.currency,
    kind: inv.kind,
    supplier: {
      name: inv.company.name,
      fiscalCode: inv.company.fiscalCode,
      vatNumber: inv.company.vatNumber,
      sdiRecipientCode: inv.company.sdiRecipientCode,
      pec: inv.company.pec,
    },
    buyer,
    callbackUrl: opts.callbackUrl,
  };
}

@Injectable()
export class SdiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async enqueue(data: SdiEnqueueBody, user: JwtUser) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: data.invoiceId },
      include: {
        company: true,
        reservation: {
          select: {
            customerName: true,
            customer: {
              select: {
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
      },
    });
    if (!inv) {
      throw new NotFoundException(`Invoice not found: ${data.invoiceId}`);
    }
    assertSameCompany(user, inv.companyId, `Invoice not found: ${data.invoiceId}`);
    if (inv.status !== 'ISSUED') {
      throw new BadRequestException('SDI submission requires an ISSUED document (not draft or void)');
    }

    const existing = await this.prisma.sdiInvoiceSubmission.findFirst({
      where: {
        invoiceId: inv.id,
        status: { in: ['MOCK_SENT', 'SENT', 'PROCESSING'] },
      },
    });
    if (existing) {
      throw new ConflictException(
        'An SDI handoff is already in progress or completed for this invoice',
      );
    }

    const company = inv.company;
    if (company.sdiAdapter === 'OFF') {
      return this.finishSubmission(
        await this.createSubmission(inv.id, inv.companyId, 'SKIPPED', {
          errorMessage: 'Company: SDI adapter OFF (E4)',
        }),
        user,
      );
    }

    if (company.sdiAdapter === 'HTTP' && !company.sdiHttpUrl?.trim()) {
      throw new BadRequestException('Set company sdiHttpUrl (Organization → SDI), or use MOCK / OFF adapter');
    }

    const sub = await this.createSubmission(inv.id, inv.companyId, 'PENDING', {});

    if (company.sdiAdapter === 'MOCK') {
      const idT = `MOCK-${sub.id.slice(0, 8).toUpperCase()}`;
      return this.finishSubmission(
        await this.prisma.sdiInvoiceSubmission.update({
          where: { id: sub.id },
          data: {
            status: 'MOCK_SENT',
            idTracciatura: idT,
            processedAt: new Date(),
            attemptCount: 1,
          },
        }),
        user,
        { idTracciatura: idT },
      );
    }

    return this.postToHttpMiddleware(sub.id, inv, company.sdiHttpUrl!.trim(), user);
  }

  private async createSubmission(
    invoiceId: string,
    companyId: string,
    status: 'PENDING' | 'SKIPPED',
    extra: { errorMessage?: string },
  ) {
    return this.prisma.sdiInvoiceSubmission.create({
      data: {
        companyId,
        invoiceId,
        status,
        errorMessage: extra.errorMessage,
        attemptCount: status === 'SKIPPED' ? 0 : 0,
        processedAt: status === 'SKIPPED' ? new Date() : null,
      },
    });
  }

  private async finishSubmission(
    row: {
      id: string;
      companyId: string;
      invoiceId: string;
      status: string;
      idTracciatura: string | null;
    },
    user: JwtUser,
    metadata?: { idTracciatura?: string },
  ) {
    if (row.status === 'MOCK_SENT' || row.status === 'SENT' || row.status === 'SKIPPED') {
      await this.audit.log({
        userId: user.sub,
        action: 'sdi.submission',
        entity: 'SdiInvoiceSubmission',
        entityId: row.id,
        metadata: {
          companyId: row.companyId,
          invoiceId: row.invoiceId,
          status: row.status,
          ...metadata,
        },
      });
    }
    return this.prisma.sdiInvoiceSubmission.findUniqueOrThrow({
      where: { id: row.id },
    });
  }

  private async postToHttpMiddleware(
    submissionId: string,
    inv: InvoiceForSdiHandoff,
    url: string,
    user: JwtUser,
  ) {
    await this.prisma.sdiInvoiceSubmission.update({
      where: { id: submissionId },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });

    const callbackUrl = this.config.get<string>('SDI_CALLBACK_URL')?.trim() || null;
    const body = buildSdiMiddlewareBody(submissionId, inv, { callbackUrl });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Car-Rental-Integration': 'sdi',
    };
    const httpSecret = this.config.get<string>('SDI_HTTP_SECRET')?.trim();
    if (httpSecret) {
      headers.Authorization = `Bearer ${httpSecret}`;
    }

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'fetch failed';
      const failed = await this.prisma.sdiInvoiceSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          errorMessage: msg.slice(0, 2000),
          processedAt: new Date(),
        },
      });
      clearTimeout(to);
      await this.audit.log({
        userId: user.sub,
        action: 'sdi.submission',
        entity: 'SdiInvoiceSubmission',
        entityId: submissionId,
        metadata: {
          companyId: inv.companyId,
          invoiceId: inv.id,
          status: 'FAILED',
          error: msg.slice(0, 200),
        },
      });
      return failed;
    }
    clearTimeout(to);

    const text = await res.text();
    if (!res.ok) {
      return this.prisma.sdiInvoiceSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          errorMessage: `HTTP ${res.status} ${text.slice(0, 1500)}`,
          processedAt: new Date(),
        },
      });
    }

    if (res.status === 202) {
      let idT: string | null = null;
      if (text.trim()) {
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          const v = j.idTracciatura;
          if (typeof v === 'string' && v.trim()) idT = v.trim();
        } catch {
          /* */
        }
      }
      const out = await this.prisma.sdiInvoiceSubmission.update({
        where: { id: submissionId },
        data: {
          idTracciatura: idT,
          errorMessage: null,
        },
      });
      await this.audit.log({
        userId: null,
        action: 'sdi.submission_async_accepted',
        entity: 'SdiInvoiceSubmission',
        entityId: submissionId,
        metadata: {
          companyId: inv.companyId,
          invoiceId: inv.id,
          status: 'PROCESSING',
          idTracciatura: idT,
        },
      });
      return out;
    }

    let idSent: string | null = null;
    if (text.trim()) {
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const v = j.idTracciatura;
        if (typeof v === 'string' && v.trim()) idSent = v.trim();
      } catch {
        /* empty or non-JSON 2xx body — still SENT */
      }
    }
    const out = await this.prisma.sdiInvoiceSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'SENT',
        idTracciatura: idSent,
        errorMessage: null,
        processedAt: new Date(),
      },
    });
    return this.finishSubmission(out, user, { idTracciatura: idSent ?? undefined });
  }

  /**
   * E4: certified / long-running SDI path — middleware completes later via this endpoint
   * (`SDI_CALLBACK_SECRET`, optional `SDI_CALLBACK_URL` in handoff JSON).
   */
  async handleMiddlewareCallback(
    authorization: string | undefined,
    rawBody: unknown,
    ip: string | null | undefined,
  ) {
    const secret = this.config.get<string>('SDI_CALLBACK_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('SDI_CALLBACK_SECRET is not configured');
    }
    const expected = `Bearer ${secret}`;
    const auth = authorization?.trim() ?? '';
    if (auth !== expected) {
      throw new UnauthorizedException('Invalid callback authorization');
    }
    const data = sdiCallbackBodySchema.parse(rawBody);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.sdiInvoiceSubmission.findUnique({ where: { id: data.submissionId } });
      if (!row) {
        throw new NotFoundException(`SDI submission not found: ${data.submissionId}`);
      }

      if (row.status === 'SENT' && data.status === 'SENT') {
        if (data.idTracciatura?.trim() && !row.idTracciatura) {
          return tx.sdiInvoiceSubmission.update({
            where: { id: row.id },
            data: { idTracciatura: data.idTracciatura.trim() },
          });
        }
        return row;
      }
      if (row.status === 'FAILED' && data.status === 'FAILED') {
        return row;
      }

      if (row.status !== 'PROCESSING' && row.status !== 'PENDING') {
        throw new ConflictException(
          `Submission ${row.id} is ${row.status}; callbacks only while PENDING or PROCESSING`,
        );
      }

      if (data.status === 'SENT') {
        return tx.sdiInvoiceSubmission.update({
          where: { id: row.id },
          data: {
            status: 'SENT',
            idTracciatura: data.idTracciatura?.trim() || row.idTracciatura,
            errorMessage: null,
            processedAt: new Date(),
          },
        });
      }

      return tx.sdiInvoiceSubmission.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          errorMessage: (data.errorMessage?.trim() || 'Middleware reported SDI failure').slice(0, 2000),
          processedAt: new Date(),
        },
      });
    });

    await this.audit.log({
      userId: null,
      action: 'sdi.callback',
      entity: 'SdiInvoiceSubmission',
      entityId: updated.id,
      metadata: {
        companyId: updated.companyId,
        invoiceId: updated.invoiceId,
        status: updated.status,
        idTracciatura: updated.idTracciatura,
      },
      ip: ip ?? null,
    });

    return { ok: true, submissionId: updated.id, status: updated.status };
  }

  async listSubmissions(
    user: JwtUser,
    q: { companyId?: string; invoiceId?: string },
  ) {
    if (q.invoiceId) {
      const inv = await this.prisma.invoice.findUnique({ where: { id: q.invoiceId } });
      if (!inv) {
        throw new NotFoundException(`Invoice not found: ${q.invoiceId}`);
      }
      assertSameCompany(user, inv.companyId, `Invoice not found: ${q.invoiceId}`);
    }
    if (isAdminCrossCompany(user) && !q.companyId && !q.invoiceId) {
      throw new BadRequestException('Provide companyId and/or invoiceId for SDI submission list');
    }
    const companyF = effectiveListCompanyFilter(user, q.companyId);
    const where: { companyId?: string; invoiceId?: string } = {
      ...companyF,
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
    };
    return this.prisma.sdiInvoiceSubmission.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
