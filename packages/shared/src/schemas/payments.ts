import { z } from 'zod';

export const createCheckoutSessionBodySchema = z
  .object({
    /// Absolute URLs; must include {CHECKOUT_SESSION_ID} in success path if you want the session id in your UI (Stripe replaces the placeholder)
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  })
  .strict();

export type CreateCheckoutSessionBody = z.infer<typeof createCheckoutSessionBodySchema>;

/** C1: pay online for a **PUBLIC_WEB** quote — proves identity with the same email as on the booking (no login). */
export const publicRentalCheckoutBodySchema = z
  .object({
    customerEmail: z.string().email().max(320),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  })
  .strict();

export type PublicRentalCheckoutBody = z.infer<typeof publicRentalCheckoutBodySchema>;

/** Manual-capture security deposit; default amount from vehicle class `defaultDepositCents` when omitted */
export const createDepositCheckoutSessionBodySchema = z
  .object({
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    amountCents: z.number().int().positive().optional(),
  })
  .strict();

export type CreateDepositCheckoutSessionBody = z.infer<typeof createDepositCheckoutSessionBodySchema>;

/** Manual-capture deposit: omit `amountCents` to capture the full remaining hold; else partial capture (remainder released). */
export const captureDepositBodySchema = z
  .object({
    amountCents: z.number().int().min(1).optional(),
  })
  .strict();

export type CaptureDepositBody = z.infer<typeof captureDepositBodySchema>;

/** Refund captured rent (Checkout) or a captured security deposit; omit amountCents for a full refund */
export const createStripeRefundBodySchema = z
  .object({
    target: z.enum(['RENTAL', 'DEPOSIT']),
    amountCents: z.number().int().positive().optional(),
  })
  .strict();

export type CreateStripeRefundBody = z.infer<typeof createStripeRefundBodySchema>;

/** Query for GET …/reconciliation (date-only strings, UTC day bounds on the server) */
export const reconciliationQuerySchema = z
  .object({
    companyId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    format: z.enum(['json', 'csv']).optional().default('json'),
  })
  .strict()
  .refine((a) => a.from <= a.to, { path: ['to'], message: 'to must be on or after from' });

export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>;

/** Desk/API Stripe refund recorded in `StripeRefundLedger` (UTC `createdAt` in export window). */
export type ReconciliationRefundRow = {
  ledgerId: string;
  reservationId: string;
  stripeRefundId: string;
  amountCents: number;
  currency: string;
  kind: 'RENTAL' | 'DEPOSIT';
  createdByUserId: string | null;
  createdAt: string;
};

/** One reservation row in GET …/payments/stripe/reconciliation (JSON) */
export type ReconciliationRow = {
  reservationId: string;
  status: string;
  source: string;
  customerName: string;
  matchReason: 'RENTAL_PAID_IN_WINDOW' | 'DEPOSIT_ACTIVITY_IN_WINDOW' | 'BOTH';
  totalCents: number | null;
  currency: string;
  paidAt: string | null;
  stripeCheckoutSessionId: string | null;
  depositHoldStatus: string;
  depositHoldCents: number | null;
  stripeDepositCheckoutSessionId: string | null;
  stripeDepositPaymentIntentId: string | null;
  pickupAt: string;
  returnAt: string;
  updatedAt: string;
};

export type ReconciliationResponse = {
  companyId: string;
  from: string;
  to: string;
  generatedAt: string;
  rowCount: number;
  /** Stripe `checkout.session.completed` events recorded in the window (idempotence log) */
  processedStripeEventCount: number;
  /** Refunds created via desk/API with ledger rows in the window (same UTC bounds). */
  refundRowCount: number;
  note: string;
  rows: ReconciliationRow[];
  refunds: ReconciliationRefundRow[];
};
