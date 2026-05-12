import { z } from 'zod';

const trimOpt = (s: string | undefined) => (s === undefined ? undefined : s.trim() || undefined);

/** B4: counsel-approved privacy notice rows per company (version id should match `Customer.privacyNoticeVersion` when applied). */
export const createCompanyPrivacyNoticeBodySchema = z
  .object({
    version: z.string().min(1).max(64).transform((s) => s.trim()),
    policyUrl: z.string().max(512).optional().transform(trimOpt),
    /** `YYYY-MM-DD` or empty to omit */
    effectiveFrom: z
      .string()
      .max(32)
      .optional()
      .transform((s) => trimOpt(s)),
    notes: z.string().max(500).optional().transform(trimOpt),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.effectiveFrom != null && d.effectiveFrom !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveFrom)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'effectiveFrom must be YYYY-MM-DD',
          path: ['effectiveFrom'],
        });
      }
    }
    if (d.policyUrl != null && d.policyUrl !== '') {
      try {
        // eslint-disable-next-line no-new
        new URL(d.policyUrl);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'policyUrl must be a valid URL',
          path: ['policyUrl'],
        });
      }
    }
  });

export type CreateCompanyPrivacyNoticeBody = z.infer<typeof createCompanyPrivacyNoticeBodySchema>;
