import { z } from 'zod';

/** VAT in basis points; 2200 = 22.00% */
export function computeInvoiceAmounts(subtotalCents: number, vatRateBps: number) {
  const vatCents = Math.round((subtotalCents * vatRateBps) / 10_000);
  return { vatCents, totalCents: subtotalCents + vatCents };
}

const currencyCode = z.string().length(3).transform((c) => c.toUpperCase());

export const createInvoiceSchema = z
  .object({
    companyId: z.string().uuid(),
    kind: z.enum(['INVOICE', 'CREDIT_NOTE']),
    reservationId: z.string().uuid().optional(),
    /** Required when `kind` is `CREDIT_NOTE` (must be an **ISSUED** `INVOICE`) */
    creditedInvoiceId: z.string().uuid().optional(),
    subtotalCents: z.number().int().min(0).max(1_000_000_000),
    vatRateBps: z.number().int().min(0).max(100_000).default(2200),
    currency: z.union([z.literal(''), z.undefined(), currencyCode]).transform((c) => (c && c.length ? c : 'EUR')),
    description: z.string().max(8000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.kind === 'CREDIT_NOTE' && !d.creditedInvoiceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'creditedInvoiceId is required for CREDIT_NOTE',
        path: ['creditedInvoiceId'],
      });
    }
    if (d.kind === 'INVOICE' && d.creditedInvoiceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'creditedInvoiceId only allowed for CREDIT_NOTE',
        path: ['creditedInvoiceId'],
      });
    }
  });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    subtotalCents: z.number().int().min(0).max(1_000_000_000).optional(),
    vatRateBps: z.number().int().min(0).max(100_000).optional(),
    currency: currencyCode.optional(),
    description: z.string().max(8000).nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
