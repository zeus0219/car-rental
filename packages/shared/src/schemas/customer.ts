import { z } from 'zod';
import { isValidItalianFiscalCode, isValidItalianVatNumber } from '../italian-fiscal';

const emailStored = z
  .string()
  .email()
  .max(320)
  .transform((s) => s.trim().toLowerCase());

/** Optional Italian B3 fields; empty strings cleared to undefined before API persist */
const optFiscal = z
  .string()
  .max(32)
  .optional()
  .transform((s) => (s === undefined ? undefined : s.trim() || undefined));
const optVat = z
  .string()
  .max(20)
  .optional()
  .transform((s) => (s === undefined ? undefined : s.trim() || undefined));
const optSdi = z
  .string()
  .max(10)
  .optional()
  .transform((s) => (s === undefined ? undefined : s.trim().toUpperCase() || undefined));
const optPec = z
  .string()
  .max(320)
  .optional()
  .transform((s) => (s === undefined ? undefined : s.trim().toLowerCase() || undefined));

export const createCustomerSchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().min(1).max(200),
    email: emailStored,
    phone: z.string().min(3).max(40),
    notes: z.string().max(2000).optional(),
    fiscalCode: optFiscal,
    vatNumber: optVat,
    sdiRecipientCode: optSdi,
    pec: optPec,
  })
  .superRefine((d, ctx) => {
    if (d.pec) {
      const r = z.string().email().safeParse(d.pec);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid PEC email', path: ['pec'] });
      }
    }
    if (d.fiscalCode != null && d.fiscalCode !== '' && !isValidItalianFiscalCode(d.fiscalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid Italian fiscal code (codice fiscale)',
        path: ['fiscalCode'],
      });
    }
    if (d.vatNumber != null && d.vatNumber !== '' && !isValidItalianVatNumber(d.vatNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid Italian VAT number (11 digits, IT-prefixed allowed)',
        path: ['vatNumber'],
      });
    }
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z
      .string()
      .email()
      .max(320)
      .transform((s) => s.trim().toLowerCase())
      .optional(),
    phone: z.string().min(3).max(40).optional(),
    notes: z.string().max(2000).nullable().optional(),
    fiscalCode: z.string().max(32).nullable().optional(),
    vatNumber: z.string().max(20).nullable().optional(),
    sdiRecipientCode: z.string().max(10).nullable().optional(),
    pec: z.string().max(320).nullable().optional(),
    privacyNoticeVersion: z.string().max(64).nullable().optional(),
    privacyNoticeAcceptedAt: z.union([z.null(), z.string().datetime()]).optional(),
    marketingEmailOptIn: z.boolean().optional(),
    marketingOptInAt: z.union([z.null(), z.string().datetime()]).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.pec != null && d.pec !== '') {
      const r = z.string().email().safeParse(d.pec);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid PEC email', path: ['pec'] });
      }
    }
    if (d.fiscalCode !== undefined && d.fiscalCode !== null && d.fiscalCode.trim() !== '') {
      if (!isValidItalianFiscalCode(d.fiscalCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid Italian fiscal code (codice fiscale)',
          path: ['fiscalCode'],
        });
      }
    }
    if (d.vatNumber !== undefined && d.vatNumber !== null && d.vatNumber.trim() !== '') {
      if (!isValidItalianVatNumber(d.vatNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid Italian VAT number (11 digits, IT-prefixed allowed)',
          path: ['vatNumber'],
        });
      }
    }
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/** B1: dedupe — `POST /customers/:id/merge` removes `:id` after moving links to `intoCustomerId`. */
export const mergeCustomerBodySchema = z
  .object({
    intoCustomerId: z.string().uuid(),
  })
  .strict();

export type MergeCustomerBody = z.infer<typeof mergeCustomerBodySchema>;
