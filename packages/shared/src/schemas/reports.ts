import { z } from 'zod';

/** UTC calendar day bounds (inclusive from, inclusive to) — API interprets as date-only */
export const companyReportQuerySchema = z
  .object({
    companyId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.from > d.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '`from` must be on or before `to`', path: ['from'] });
    }
  });

export type CompanyReportQuery = z.infer<typeof companyReportQuerySchema>;

/** G3: staff queue of uploaded documents awaiting OCR (same row filter as health / metrics). */
export const customerDocumentsOcrPendingQuerySchema = z
  .object({
    companyId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type CustomerDocumentsOcrPendingQuery = z.infer<typeof customerDocumentsOcrPendingQuerySchema>;
