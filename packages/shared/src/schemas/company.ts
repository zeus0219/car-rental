import { z } from 'zod';
import { isValidItalianFiscalCode, isValidItalianVatNumber } from '../italian-fiscal';
import { sdiAdapterValues } from './sdi';

export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  oneWayFeeCents: z.number().int().min(0).optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const cargosAdapterValues = ['MOCK', 'HTTP', 'OFF'] as const;
export const cargosEnvironmentValues = ['TEST', 'PRODUCTION'] as const;

export const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    oneWayFeeCents: z.number().int().min(0).nullable().optional(),
    cargosInScope: z.boolean().optional(),
    cargosEnvironment: z.enum(cargosEnvironmentValues).optional(),
    cargosAdapter: z.enum(cargosAdapterValues).optional(),
    /** HTTP adapter only — optional middleware URL; empty string clears */
    cargosHttpUrl: z.string().url().max(2000).nullable().optional().or(z.literal('')),
    /// Minutes before pickup for policy warnings (0–7d); null = unset
    cargosCutoffMinutesBeforePickup: z.number().int().min(0).max(10080).nullable().optional(),
    /** E4: SDI; empty `sdiHttpUrl` clears */
    sdiAdapter: z.enum(sdiAdapterValues).optional(),
    sdiHttpUrl: z.string().url().max(2000).nullable().optional().or(z.literal('')),
    /** B3: optional Italian fiscal fields on the lessor company */
    fiscalCode: z
      .string()
      .max(32)
      .nullable()
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim();
        return t === '' ? null : t;
      }),
    vatNumber: z
      .string()
      .max(20)
      .nullable()
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim();
        return t === '' ? null : t;
      }),
    sdiRecipientCode: z
      .string()
      .max(10)
      .nullable()
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim().toUpperCase();
        return t === '' ? null : t;
      }),
    pec: z
      .string()
      .max(320)
      .nullable()
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim().toLowerCase();
        return t === '' ? null : t;
      }),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.pec != null && d.pec !== '') {
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

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
