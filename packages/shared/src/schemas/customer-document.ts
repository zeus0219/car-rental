import { z } from 'zod';

export const customerDocumentTypeValues = ['ID_CARD', 'DRIVING_LICENSE', 'PASSPORT', 'OTHER'] as const;
export type CustomerDocumentType = (typeof customerDocumentTypeValues)[number];

const presignMime = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_CUSTOMER_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const customerDocumentPresignBodySchema = z
  .object({
    originalName: z.string().min(1).max(200),
    mimeType: presignMime,
    sizeBytes: z.number().int().min(1).max(MAX_CUSTOMER_DOCUMENT_BYTES),
    docType: z.enum(customerDocumentTypeValues),
    /** Optional: policy / legal retention target (metadata only in v1) */
    retentionUntil: z.coerce.date().nullable().optional(),
  })
  .strict();

export type CustomerDocumentPresignBody = z.infer<typeof customerDocumentPresignBodySchema>;

export const customerDocumentVerificationBodySchema = z
  .object({
    verified: z.boolean(),
  })
  .strict();

export type CustomerDocumentVerificationBody = z.infer<typeof customerDocumentVerificationBodySchema>;

/** G3: parsed suggestion blob (mock or future vendor) — never trusted until staff applies. */
export const customerDocumentOcrSuggestionSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    documentNumber: z.string().min(1).max(80).optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fiscalCode: z.string().min(1).max(32).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export type CustomerDocumentOcrSuggestion = z.infer<typeof customerDocumentOcrSuggestionSchema>;

/**
 * G3: async OCR completion from your adapter (Bearer `WORKER_INTERNAL_SECRET`).
 * POST exactly one of `suggestion` (success) or `error` (failure message).
 */
export const customerDocumentOcrAsyncCompletionBodySchema = z
  .object({
    documentId: z.string().uuid(),
    /** Stored on `CustomerDocument.ocrVendor` when `suggestion` succeeds (default `ASYNC_CALLBACK`). */
    vendor: z.string().min(1).max(120).optional(),
    suggestion: customerDocumentOcrSuggestionSchema.optional(),
    error: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const errTrim = d.error?.trim() ?? '';
    const hasErr = errTrim.length > 0;
    const hasSug = d.suggestion != null;
    if (hasErr === hasSug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of suggestion (object) or error (non-empty string)',
        path: ['documentId'],
      });
    }
  });

export type CustomerDocumentOcrAsyncCompletionBody = z.infer<
  typeof customerDocumentOcrAsyncCompletionBodySchema
>;

export const applyCustomerDocumentOcrBodySchema = z
  .object({
    applyName: z.boolean().optional(),
    applyFiscalCode: z.boolean().optional(),
    appendDetailsToNotes: z.boolean().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (!d.applyName && !d.applyFiscalCode && !d.appendDetailsToNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select at least one of applyName, applyFiscalCode, appendDetailsToNotes',
        path: ['applyName'],
      });
    }
  });

export type ApplyCustomerDocumentOcrBody = z.infer<typeof applyCustomerDocumentOcrBodySchema>;
