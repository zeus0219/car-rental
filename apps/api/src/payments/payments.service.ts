import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateCheckoutSessionBody,
  CaptureDepositBody,
  CreateDepositCheckoutSessionBody,
  CreateStripeRefundBody,
  type PublicRentalCheckoutBody,
  type ReconciliationQuery,
  type ReconciliationRefundRow,
  type ReconciliationResponse,
  type ReconciliationRow,
} from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientKnownRequestError } from '../prisma/prisma-errors';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { DepositHoldStatus, Prisma, StripeRefundKind } from '@prisma/client';
import Stripe from 'stripe';
import { JwtUser } from '../auth/types';
import {
  assertAgentReservationInScope,
  assertSameCompany,
  isAdminCrossCompany,
  isAgentStationScoped,
} from '../auth/company-access';
import { StripeService } from './stripe.service';
import { PartnerWebhookService } from '../partner/partner-webhook.service';
import { Request } from 'express';

export type StripeWebhookOutcome = 'paid' | 'deposit_held' | 'ignored' | 'duplicate';

export type ApplyCheckoutSessionCompletedResult = {
  received: true;
  outcome: StripeWebhookOutcome;
  /** G2: set when rental `paid` path moved **`status`** on a **PARTNER** booking. */
  partnerStatusWebhook?: { partnerApiKeyId: string; reservationId: string; previousStatus: string };
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly partnerWebhook: PartnerWebhookService,
  ) {}

  getStripeAvailable(): { stripe: boolean } {
    return { stripe: this.stripe.isEnabled() };
  }

  /**
   * Accounting-friendly export: reservations with rental `paidAt` in [from, to] (UTC),
   * or non-NONE deposit activity where `updatedAt` is in the same window; plus `StripeRefundLedger`
   * rows whose `createdAt` is in that window (desk/API refunds). Dashboard-only refunds stay outside the ledger.
   */
  async getReconciliation(
    query: ReconciliationQuery,
    user: JwtUser,
  ): Promise<{ format: 'json'; body: ReconciliationResponse } | { format: 'csv'; csv: string; filename: string }> {
    if (!isAdminCrossCompany(user) && query.companyId !== user.companyId) {
      throw new ForbiddenException('Not allowed to access this company');
    }
    const fromD = new Date(query.from + 'T00:00:00.000Z');
    const toD = new Date(query.to + 'T23:59:59.999Z');
    const paymentOr: Prisma.ReservationWhereInput[] = [
      { paidAt: { gte: fromD, lte: toD } },
      {
        AND: [
          { NOT: { depositHoldStatus: 'NONE' } },
          { updatedAt: { gte: fromD, lte: toD } },
        ],
      },
    ];
    const where: Prisma.ReservationWhereInput = { companyId: query.companyId };
    if (isAgentStationScoped(user)) {
      const s = user.stationId!;
      where.AND = [
        { OR: paymentOr },
        { OR: [{ pickupStationId: s }, { returnStationId: s }] },
      ];
    } else {
      where.OR = paymentOr;
    }
    const refundWhereBase: Prisma.StripeRefundLedgerWhereInput = {
      companyId: query.companyId,
      createdAt: { gte: fromD, lte: toD },
    };
    const refundWhere: Prisma.StripeRefundLedgerWhereInput = isAgentStationScoped(user)
      ? {
          ...refundWhereBase,
          reservation: {
            OR: [{ pickupStationId: user.stationId! }, { returnStationId: user.stationId! }],
          },
        }
      : refundWhereBase;
    const [rows, processedStripeEventCount, refundLedgers] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          source: true,
          customerName: true,
          totalCents: true,
          currency: true,
          paidAt: true,
          stripeCheckoutSessionId: true,
          depositHoldStatus: true,
          depositHoldCents: true,
          stripeDepositCheckoutSessionId: true,
          stripeDepositPaymentIntentId: true,
          pickupAt: true,
          returnAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.processedStripeEvent.count({
        where: { createdAt: { gte: fromD, lte: toD } },
      }),
      this.prisma.stripeRefundLedger.findMany({
        where: refundWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          reservationId: true,
          stripeRefundId: true,
          amountCents: true,
          currency: true,
          kind: true,
          createdByUserId: true,
          createdAt: true,
        },
      }),
    ]);
    const mapped: ReconciliationRow[] = rows.map((r) => {
      const pa = r.paidAt;
      const inPaid =
        pa != null && pa.getTime() >= fromD.getTime() && pa.getTime() <= toD.getTime();
      const inDeposit =
        r.depositHoldStatus !== 'NONE' &&
        r.updatedAt.getTime() >= fromD.getTime() &&
        r.updatedAt.getTime() <= toD.getTime();
      const matchReason: ReconciliationRow['matchReason'] = inPaid && inDeposit
        ? 'BOTH'
        : inPaid
          ? 'RENTAL_PAID_IN_WINDOW'
          : 'DEPOSIT_ACTIVITY_IN_WINDOW';
      return {
        reservationId: r.id,
        status: r.status,
        source: r.source,
        customerName: r.customerName,
        matchReason,
        totalCents: r.totalCents,
        currency: r.currency,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        stripeCheckoutSessionId: r.stripeCheckoutSessionId,
        depositHoldStatus: r.depositHoldStatus,
        depositHoldCents: r.depositHoldCents,
        stripeDepositCheckoutSessionId: r.stripeDepositCheckoutSessionId,
        stripeDepositPaymentIntentId: r.stripeDepositPaymentIntentId,
        pickupAt: r.pickupAt.toISOString(),
        returnAt: r.returnAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
    const refunds: ReconciliationRefundRow[] = refundLedgers.map((x) => ({
      ledgerId: x.id,
      reservationId: x.reservationId,
      stripeRefundId: x.stripeRefundId,
      amountCents: x.amountCents,
      currency: x.currency,
      kind: x.kind === StripeRefundKind.RENTAL ? 'RENTAL' : 'DEPOSIT',
      createdByUserId: x.createdByUserId,
      createdAt: x.createdAt.toISOString(),
    }));
    const body: ReconciliationResponse = {
      companyId: query.companyId,
      from: query.from,
      to: query.to,
      generatedAt: new Date().toISOString(),
      rowCount: mapped.length,
      processedStripeEventCount,
      refundRowCount: refunds.length,
      note:
        'Rental paidAt is set by webhook when checkout completes. Desk/API refunds are listed here and in the CSV refund section (UTC createdAt). Use Stripe Balance for fees and for refunds not created via this API.',
      rows: mapped,
      refunds,
    };
    if (query.format === 'csv') {
      return {
        format: 'csv',
        filename: `stripe-reconciliation-${query.from}-to-${query.to}.csv`,
        csv: this.buildReconciliationCsv(mapped, refunds, query, processedStripeEventCount, body.note),
      };
    }
    return { format: 'json', body };
  }

  private buildReconciliationCsv(
    rows: ReconciliationRow[],
    refunds: ReconciliationRefundRow[],
    q: ReconciliationQuery,
    processedStripeEventCount: number,
    note: string,
  ): string {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const header = [
      'reservationId',
      'status',
      'source',
      'customerName',
      'matchReason',
      'totalCents',
      'currency',
      'paidAt',
      'stripeCheckoutSessionId',
      'depositHoldStatus',
      'depositHoldCents',
      'stripeDepositCheckoutSessionId',
      'stripeDepositPaymentIntentId',
      'pickupAt',
      'returnAt',
      'updatedAt',
    ];
    const lines = [
      `# companyId=${q.companyId} from=${q.from} to=${q.to} generated=${new Date().toISOString()}`,
      `# processedStripeEventCount(windows)=${processedStripeEventCount}`,
      `# ${note.replace(/\r?\n/g, ' ')}`,
      header.join(','),
      ...rows.map((r) =>
        [
          esc(r.reservationId),
          esc(r.status),
          esc(r.source),
          esc(r.customerName),
          esc(r.matchReason),
          esc(r.totalCents),
          esc(r.currency),
          esc(r.paidAt),
          esc(r.stripeCheckoutSessionId),
          esc(r.depositHoldStatus),
          esc(r.depositHoldCents),
          esc(r.stripeDepositCheckoutSessionId),
          esc(r.stripeDepositPaymentIntentId),
          esc(r.pickupAt),
          esc(r.returnAt),
          esc(r.updatedAt),
        ].join(','),
      ),
    ];
    const refundBlocks: string[] = [];
    if (refunds.length > 0) {
      const refundHeader = [
        'ledgerId',
        'reservationId',
        'stripeRefundId',
        'amountCents',
        'currency',
        'kind',
        'createdAt',
        'createdByUserId',
      ];
      refundBlocks.push(
        '',
        '# --- Refunds (desk/API ledger, UTC createdAt in window)',
        refundHeader.join(','),
        ...refunds.map((r) =>
          [
            esc(r.ledgerId),
            esc(r.reservationId),
            esc(r.stripeRefundId),
            esc(r.amountCents),
            esc(r.currency),
            esc(r.kind),
            esc(r.createdAt),
            esc(r.createdByUserId),
          ].join(','),
        ),
      );
    }
    return [...lines, ...refundBlocks].join('\n');
  }

  private async logStripeRefundAudit(
    reservationId: string,
    user: JwtUser,
    body: CreateStripeRefundBody,
    refund: Stripe.Refund,
  ): Promise<void> {
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.stripe.refund',
      entity: 'Reservation',
      entityId: reservationId,
      metadata: {
        target: body.target,
        stripeRefundId: refund.id,
        amountCents: refund.amount,
        currency: refund.currency ?? null,
        partial: body.amountCents != null,
      },
    });
  }

  /** Best-effort after Stripe succeeds; does not revert the Stripe refund if DB insert fails. */
  private async persistRefundLedgerAfterStripe(
    r: { id: string; companyId: string },
    user: JwtUser,
    body: CreateStripeRefundBody,
    refund: Stripe.Refund,
  ): Promise<void> {
    const kind = body.target === 'RENTAL' ? StripeRefundKind.RENTAL : StripeRefundKind.DEPOSIT;
    try {
      await this.prisma.stripeRefundLedger.create({
        data: {
          companyId: r.companyId,
          reservationId: r.id,
          stripeRefundId: refund.id,
          amountCents: refund.amount,
          currency: (refund.currency || 'eur').toUpperCase(),
          kind,
          createdByUserId: user.sub,
        },
      });
    } catch (e) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.warn(`StripeRefundLedger duplicate stripeRefundId=${refund.id} reservation=${r.id}`);
        return;
      }
      this.logger.error(
        `Stripe refund ${refund.id} OK but ledger insert failed (reservation ${r.id})`,
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  /** Shared Stripe Checkout “rental” session + DB hook (desk or public C1). */
  private async createRentalStripeCheckoutSession(
    r: {
      id: string;
      companyId: string;
      customerName: string;
      customerEmail: string;
      totalCents: number | null;
      currency: string | null;
    },
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string; sessionId: string }> {
    if (!this.stripe.isEnabled()) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
    if (r.totalCents == null || r.totalCents < 1) {
      throw new BadRequestException('Set a positive totalCents on the reservation before taking payment');
    }
    const cur = (r.currency || 'EUR').toLowerCase();
    if (cur !== 'eur') {
      throw new BadRequestException('Only EUR currency is supported for Stripe in this v1 (extend mapping as needed)');
    }
    const session = await this.stripe.api.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: cur,
            product_data: {
              name: `Rental — ${r.customerName}`,
            },
            unit_amount: r.totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: r.id,
      metadata: { reservationId: r.id, companyId: r.companyId, checkoutKind: 'RENTAL' },
    });
    await this.prisma.reservation.update({
      where: { id: r.id },
      data: { stripeCheckoutSessionId: session.id },
    });
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a hosted checkout URL (check configuration)');
    }
    return { url: session.url, sessionId: session.id };
  }

  private queueRentalCheckoutLinkEmail(
    r: {
      id: string;
      companyId: string;
      customerName: string;
      customerEmail: string;
      totalCents: number | null;
      currency: string | null;
    },
    checkoutUrl: string,
  ) {
    if (!this.mail.isEnabled()) {
      return;
    }
    void this.mail
      .sendStripeCheckoutLinkEmail({
        to: r.customerEmail,
        customerName: r.customerName,
        reservationId: r.id,
        companyId: r.companyId,
        kind: 'RENTAL',
        amountCents: r.totalCents!,
        currency: r.currency || 'EUR',
        checkoutUrl,
      })
      .catch((err) => {
        this.logger.warn(
          `Stripe rental link mail failed (${r.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /** C1: customer pays a **PUBLIC_WEB** quote online (email must match; no JWT). */
  async createPublicRentalCheckoutSession(reservationId: string, body: PublicRentalCheckoutBody) {
    const r = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!r) {
      throw new NotFoundException('Reservation not found');
    }
    if (r.source !== 'PUBLIC_WEB') {
      throw new ForbiddenException('Online payment is only available for web quotes');
    }
    if (r.status !== 'QUOTE' && r.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('This booking is not in a state that accepts online rental payment');
    }
    if (r.paidAt) {
      throw new ConflictException('This reservation is already recorded as paid');
    }
    const want = body.customerEmail.trim().toLowerCase();
    if (r.customerEmail.trim().toLowerCase() !== want) {
      throw new UnauthorizedException('Email does not match this booking');
    }
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.replace(/\/$/, '') ?? 'http://localhost:3001';
    const defSuccess =
      this.config.get<string>('STRIPE_PUBLIC_CHECKOUT_SUCCESS_URL') ??
      `${base}/quote?stripe=rental_success&session_id={CHECKOUT_SESSION_ID}`;
    const defCancel =
      this.config.get<string>('STRIPE_PUBLIC_CHECKOUT_CANCEL_URL') ?? `${base}/quote?stripe=rental_cancel`;
    const successUrl = body.successUrl ?? defSuccess;
    const cancelUrl = body.cancelUrl ?? defCancel;
    const out = await this.createRentalStripeCheckoutSession(r, successUrl, cancelUrl);
    this.queueRentalCheckoutLinkEmail(r, out.url);
    return out;
  }

  async createCheckoutSession(
    reservationId: string,
    user: JwtUser,
    body: CreateCheckoutSessionBody,
  ) {
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
    if (r.paidAt) {
      throw new ConflictException('This reservation is already recorded as paid');
    }
    const defSuccess =
      this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL') ??
      'http://localhost:3001/desk/reservations?stripe=success&session_id={CHECKOUT_SESSION_ID}';
    const defCancel =
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL') ?? 'http://localhost:3001/desk/reservations?stripe=cancelled';
    const successUrl = body.successUrl ?? defSuccess;
    const cancelUrl = body.cancelUrl ?? defCancel;
    const out = await this.createRentalStripeCheckoutSession(r, successUrl, cancelUrl);
    this.queueRentalCheckoutLinkEmail(r, out.url);
    return out;
  }

  async createDepositCheckoutSession(
    reservationId: string,
    user: JwtUser,
    body: CreateDepositCheckoutSessionBody,
  ) {
    if (!this.stripe.isEnabled()) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { vehicle: { include: { vehicleClass: true } } },
    });
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
    if (r.status === 'CANCELLED') {
      throw new BadRequestException('Will not take a deposit for a cancelled reservation');
    }
    if (r.depositHoldStatus === 'UNCAPTURED') {
      throw new ConflictException('Release the existing uncaptured deposit hold or capture it before starting a new one');
    }
    if (r.depositHoldStatus === 'CAPTURED') {
      throw new ConflictException('A deposit was already captured for this reservation in v1 (no second on-book hold yet)');
    }
    const amountCents = body.amountCents ?? r.vehicle.vehicleClass.defaultDepositCents;
    if (amountCents == null || amountCents < 1) {
      throw new BadRequestException(
        'Set amountCents on the request, or set defaultDepositCents on the vehicle class',
      );
    }
    const defSuccess =
      this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL') ??
      'http://localhost:3001/desk/reservations?stripe=deposit&session_id={CHECKOUT_SESSION_ID}';
    const defCancel =
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL') ?? 'http://localhost:3001/desk/reservations?stripe=deposit_cancelled';
    const successUrl = body.successUrl ?? defSuccess;
    const cancelUrl = body.cancelUrl ?? defCancel;
    const cur = (r.currency || 'EUR').toLowerCase();
    if (cur !== 'eur') {
      throw new BadRequestException('Only EUR currency is supported for Stripe in this v1 (extend mapping as needed)');
    }
    const session = await this.stripe.api.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: cur,
            product_data: {
              name: `Security deposit — ${r.customerName}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: r.id,
      payment_intent_data: {
        capture_method: 'manual',
        metadata: { reservationId: r.id, companyId: r.companyId, checkoutKind: 'DEPOSIT' },
      },
      metadata: { reservationId: r.id, companyId: r.companyId, checkoutKind: 'DEPOSIT' },
    });
    await this.prisma.reservation.update({
      where: { id: r.id },
      data: {
        stripeDepositCheckoutSessionId: session.id,
        depositHoldCents: amountCents,
        depositHoldStatus: DepositHoldStatus.PENDING,
      },
    });
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a hosted checkout URL (check configuration)');
    }
    const out = { url: session.url, sessionId: session.id, amountCents };
    if (this.mail.isEnabled()) {
      void this.mail
        .sendStripeCheckoutLinkEmail({
          to: r.customerEmail,
          customerName: r.customerName,
          reservationId: r.id,
          companyId: r.companyId,
          kind: 'DEPOSIT',
          amountCents,
          currency: r.currency || 'EUR',
          checkoutUrl: session.url,
        })
        .catch((err) => {
          this.logger.warn(
            `Stripe deposit link mail failed (${r.id}): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    return out;
  }

  async captureDeposit(reservationId: string, user: JwtUser, body?: CaptureDepositBody) {
    if (!this.stripe.isEnabled()) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { damageReport: { select: { id: true, suggestedCaptureCents: true } } },
    });
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
    if (r.depositHoldStatus !== 'UNCAPTURED' || !r.stripeDepositPaymentIntentId) {
      throw new BadRequestException('No uncaptured deposit hold to capture (complete deposit checkout first)');
    }
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.stripe.api.paymentIntents.retrieve(r.stripeDepositPaymentIntentId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Stripe retrieve failed: ${msg}`);
    }
    const maxCap = pi.amount_capturable ?? 0;
    if (maxCap < 1) {
      throw new BadRequestException('No capturable amount on deposit PaymentIntent');
    }
    const requested = body?.amountCents;
    const captureAmount = requested ?? maxCap;
    if (captureAmount < 1 || captureAmount > maxCap) {
      throw new BadRequestException(
        `Capture amount must be between 1 and ${maxCap} cents (remaining hold)`,
      );
    }
    try {
      if (captureAmount === maxCap) {
        await this.stripe.api.paymentIntents.capture(r.stripeDepositPaymentIntentId);
      } else {
        await this.stripe.api.paymentIntents.capture(r.stripeDepositPaymentIntentId, {
          amount_to_capture: captureAmount,
        });
        const after = await this.stripe.api.paymentIntents.retrieve(r.stripeDepositPaymentIntentId);
        const remaining = after.amount_capturable ?? 0;
        if (remaining > 0) {
          try {
            await this.stripe.api.paymentIntents.cancel(r.stripeDepositPaymentIntentId);
          } catch (ce) {
            this.logger.warn(
              `Deposit hold remainder cancel after partial capture (${r.id}): ${ce instanceof Error ? ce.message : String(ce)}`,
            );
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: { depositHoldStatus: DepositHoldStatus.FAILED },
      });
      throw new BadRequestException(`Stripe capture failed: ${msg}`);
    }
    const updated = await this.prisma.reservation.update({
      where: { id: r.id },
      data: { depositHoldStatus: DepositHoldStatus.CAPTURED },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.deposit.capture',
      entity: 'Reservation',
      entityId: r.id,
      metadata: {
        captureAmountCents: captureAmount,
        capturableMaxCents: maxCap,
        partial: captureAmount < maxCap,
        stripePaymentIntentId: r.stripeDepositPaymentIntentId,
        ...(r.damageReport
          ? {
              damageReportId: r.damageReport.id,
              damageSuggestedCaptureCents: r.damageReport.suggestedCaptureCents ?? null,
            }
          : {}),
      },
    });
    return updated;
  }

  async cancelDepositHold(reservationId: string, user: JwtUser) {
    if (!this.stripe.isEnabled()) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
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
    if (r.depositHoldStatus !== 'UNCAPTURED' || !r.stripeDepositPaymentIntentId) {
      throw new BadRequestException('No uncaptured deposit hold to release (nothing to cancel on Stripe)');
    }
    try {
      await this.stripe.api.paymentIntents.cancel(r.stripeDepositPaymentIntentId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.reservation.update({
        where: { id: r.id },
        data: { depositHoldStatus: DepositHoldStatus.FAILED },
      });
      throw new BadRequestException(`Stripe cancel failed: ${msg}`);
    }
    const released = await this.prisma.reservation.update({
      where: { id: r.id },
      data: { depositHoldStatus: DepositHoldStatus.CANCELED },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.deposit.cancel_hold',
      entity: 'Reservation',
      entityId: r.id,
      metadata: { stripePaymentIntentId: r.stripeDepositPaymentIntentId },
    });
    return released;
  }

  /**
   * Refund money already captured: rental (from Checkout session → PaymentIntent) or deposit (after capture).
   * Optional partial amount in cents; default is full refund. Does not change `paidAt` / DB status; persists a
   * `StripeRefundLedger` row with Stripe’s refund id and amount for reconciliation exports.
   */
  async createRefund(reservationId: string, user: JwtUser, body: CreateStripeRefundBody) {
    if (!this.stripe.isEnabled()) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
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
    if (body.target === 'RENTAL') {
      if (!r.paidAt) {
        throw new BadRequestException('Nothing to refund: rental is not recorded as paid');
      }
      if (!r.stripeCheckoutSessionId) {
        throw new BadRequestException(
          'No Stripe Checkout session on file — this payment may not have been taken via the desk link',
        );
      }
      const session = await this.stripe.api.checkout.sessions.retrieve(r.stripeCheckoutSessionId, {
        expand: ['payment_intent'],
      });
      const rawPi = session.payment_intent;
      const piId = typeof rawPi === 'string' ? rawPi : rawPi && 'id' in rawPi ? rawPi.id : null;
      if (!piId) {
        throw new BadRequestException('Could not resolve PaymentIntent for this Checkout session');
      }
      try {
        const refund = await this.stripe.api.refunds.create({
          payment_intent: piId,
          ...(body.amountCents != null ? { amount: body.amountCents } : {}),
          metadata: { reservationId: r.id, companyId: r.companyId, refundKind: 'RENTAL' },
        });
        await this.logStripeRefundAudit(r.id, user, body, refund);
        await this.persistRefundLedgerAfterStripe(r, user, body, refund);
        return refund;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Stripe refund failed: ${msg}`);
      }
    }
    if (body.target === 'DEPOSIT') {
      if (r.depositHoldStatus !== 'CAPTURED' || !r.stripeDepositPaymentIntentId) {
        throw new BadRequestException('Deposit is not in captured state (capture the hold first, or nothing to refund)');
      }
      try {
        const refund = await this.stripe.api.refunds.create({
          payment_intent: r.stripeDepositPaymentIntentId,
          ...(body.amountCents != null ? { amount: body.amountCents } : {}),
          metadata: { reservationId: r.id, companyId: r.companyId, refundKind: 'DEPOSIT' },
        });
        await this.logStripeRefundAudit(r.id, user, body, refund);
        await this.persistRefundLedgerAfterStripe(r, user, body, refund);
        return refund;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Stripe refund failed: ${msg}`);
      }
    }
    throw new BadRequestException('Invalid refund target');
  }

  /**
   * Must receive the exact raw request body and Stripe-Signature from Stripe.
   * Idempotency: each Stripe `event.id` is stored in `ProcessedStripeEvent` once.
   *
   * **Handled types**
   * - `checkout.session.completed` — rental when `payment_status === 'paid'`; deposit when session complete.
   * - `checkout.session.async_payment_succeeded` — **E2** delayed payment methods (e.g. some wallets): same apply logic as paid rental / deposit.
   * - `checkout.session.async_payment_failed` — logged for ops alerts; no DB mutation.
   * - `payment_intent.payment_failed` — **E2** card / SCA declines; logged; no DB mutation.
   */
  async handleStripeWebhook(
    request: RawBodyRequest<Request>,
  ): Promise<{ received: true; outcome?: StripeWebhookOutcome }> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    }
    const rawBody = request.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Raw body is required (enable rawBody in Nest or JSON verify middleware)');
    }
    const signature = request.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const event = this.stripe.api.webhooks.constructEvent(rawBody, signature, secret);

    type SessionPayload = {
      id: string;
      status?: string;
      payment_status?: string;
      amount_total?: number | null;
      metadata?: { reservationId?: string; checkoutKind?: string };
      payment_intent?: string | { id: string } | null;
    };

    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as SessionPayload;
      const reservationId = session.metadata?.reservationId;
      const kind = session.metadata?.checkoutKind ?? 'RENTAL';
      this.logger.warn(
        `Stripe async_payment_failed sessionId=${session.id} kind=${kind} reservationId=${reservationId ?? 'n/a'}`,
      );
      return { received: true, outcome: 'ignored' };
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const reservationId = pi.metadata?.reservationId;
      const errMsg = pi.last_payment_error?.message ?? pi.last_payment_error?.code ?? 'n/a';
      this.logger.warn(
        `Stripe payment_intent.payment_failed pi=${pi.id} reservationId=${reservationId ?? 'n/a'} error=${errMsg}`,
      );
      return { received: true, outcome: 'ignored' };
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as SessionPayload;
      const kind = session.metadata?.checkoutKind ?? 'RENTAL';
      const reservationId = session.metadata?.reservationId;
      if (session.status !== 'complete' || !reservationId) {
        return { received: true, outcome: 'ignored' };
      }

      if (kind === 'DEPOSIT') {
        const res = await this.applyDepositCheckoutCompleted(event.id, event.type, session);
        if (res.outcome === 'deposit_held') {
          this.queueDepositHoldCustomerEmail(reservationId);
        }
        return res;
      }

      const isAsyncSuccess = event.type === 'checkout.session.async_payment_succeeded';
      if (!isAsyncSuccess && session.payment_status !== 'paid') {
        return { received: true, outcome: 'ignored' };
      }

      const res = await this.applyCheckoutSessionCompleted(
        event.id,
        event.type,
        reservationId,
        session.id,
      );
      if (res.outcome === 'paid') {
        this.queueRentalPaidCustomerEmail(reservationId);
        if (res.partnerStatusWebhook) {
          void this.partnerWebhook.enqueueReservationStatusChanged(
            res.partnerStatusWebhook.partnerApiKeyId,
            res.partnerStatusWebhook.reservationId,
            res.partnerStatusWebhook.previousStatus,
          );
        }
      }
      return res;
    }

    return { received: true, outcome: 'ignored' };
  }

  /** After webhook applies rental payment (non-blocking; failures only logged). */
  private queueRentalPaidCustomerEmail(reservationId: string): void {
    if (!this.mail.isEnabled()) {
      return;
    }
    void (async () => {
      try {
        const r = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
        if (!r || !r.customerEmail?.includes('@') || !r.paidAt) {
          return;
        }
        await this.mail.sendRentalPaymentReceivedEmail({
          to: r.customerEmail,
          customerName: r.customerName,
          reservationId: r.id,
          companyId: r.companyId,
          totalCents: r.totalCents,
          currency: r.currency || 'EUR',
          statusLabel: r.status,
          publicViewToken: r.publicViewToken,
        });
      } catch (e) {
        this.logger.warn(
          `Rental paid confirmation mail failed (${reservationId}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
  }

  private queueDepositHoldCustomerEmail(reservationId: string): void {
    if (!this.mail.isEnabled()) {
      return;
    }
    void (async () => {
      try {
        const r = await this.prisma.reservation.findUnique({ where: { id: reservationId } });
        if (!r || !r.customerEmail?.includes('@') || r.depositHoldStatus !== 'UNCAPTURED') {
          return;
        }
        await this.mail.sendDepositHoldPlacedEmail({
          to: r.customerEmail,
          customerName: r.customerName,
          reservationId: r.id,
          companyId: r.companyId,
          holdCents: r.depositHoldCents,
          currency: r.currency || 'EUR',
          publicViewToken: r.publicViewToken,
        });
      } catch (e) {
        this.logger.warn(
          `Deposit hold confirmation mail failed (${reservationId}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
  }

  private async applyDepositCheckoutCompleted(
    stripeEventId: string,
    eventType: string,
    session: {
      id: string;
      amount_total?: number | null;
      metadata?: { reservationId?: string; checkoutKind?: string };
      payment_intent?: string | { id: string } | null;
    },
  ): Promise<{ received: true; outcome: StripeWebhookOutcome }> {
    const resId = session.metadata?.reservationId;
    if (!resId) {
      return { received: true, outcome: 'ignored' };
    }
    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.processedStripeEvent.create({
          data: { id: stripeEventId, type: eventType },
        });
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          return { received: true, outcome: 'duplicate' };
        }
        throw e;
      }
      const r = await tx.reservation.findUnique({ where: { id: resId } });
      if (!r) {
        return { received: true, outcome: 'ignored' };
      }
      if (r.stripeDepositCheckoutSessionId !== session.id) {
        return { received: true, outcome: 'ignored' };
      }
      if (r.depositHoldStatus === 'UNCAPTURED' && r.stripeDepositPaymentIntentId) {
        return { received: true, outcome: 'ignored' };
      }
      const rawPi = session.payment_intent;
      const piId = typeof rawPi === 'string' ? rawPi : rawPi?.id;
      if (!piId) {
        return { received: true, outcome: 'ignored' };
      }
      const amount = session.amount_total ?? r.depositHoldCents;
      await tx.reservation.update({
        where: { id: r.id },
        data: {
          stripeDepositPaymentIntentId: piId,
          depositHoldCents: amount != null && amount > 0 ? amount : r.depositHoldCents,
          depositHoldStatus: DepositHoldStatus.UNCAPTURED,
        },
      });
      return { received: true, outcome: 'deposit_held' };
    });
  }

  private async applyCheckoutSessionCompleted(
    stripeEventId: string,
    eventType: string,
    reservationId: string,
    checkoutSessionId: string,
  ): Promise<ApplyCheckoutSessionCompletedResult> {
    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.processedStripeEvent.create({
          data: { id: stripeEventId, type: eventType },
        });
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          return { received: true, outcome: 'duplicate' };
        }
        throw e;
      }
      const r = await tx.reservation.findUnique({ where: { id: reservationId } });
      if (!r) {
        return { received: true, outcome: 'ignored' };
      }
      if (r.paidAt) {
        return { received: true, outcome: 'ignored' };
      }
      const prevStatus = r.status;
      const nextStatus = r.status === 'QUOTE' || r.status === 'PENDING_PAYMENT' ? 'CONFIRMED' : r.status;
      const partnerStatusWebhook =
        r.source === 'PARTNER' && r.createdByPartnerApiKeyId && prevStatus !== nextStatus
          ? {
              partnerApiKeyId: r.createdByPartnerApiKeyId,
              reservationId: r.id,
              previousStatus: prevStatus,
            }
          : undefined;
      await tx.reservation.update({
        where: { id: reservationId },
        data: { paidAt: new Date(), stripeCheckoutSessionId: checkoutSessionId, status: nextStatus },
      });
      return { received: true, outcome: 'paid', partnerStatusWebhook };
    });
  }
}
