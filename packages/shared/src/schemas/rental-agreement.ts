import { z } from 'zod';

const bodyZ = z.string().min(1, 'body required').max(500_000, 'body too long');

const templateVersionZ = z.union([z.string().min(1).max(200).trim(), z.null()]);

export const createRentalAgreementSchema = z
  .object({
    reservationId: z.string().uuid(),
    body: bodyZ,
    agreementTemplateVersion: z.string().min(1).max(200).trim().optional(),
  })
  .strict();

export type CreateRentalAgreementInput = z.infer<typeof createRentalAgreementSchema>;

export const updateRentalAgreementSchema = z
  .object({
    body: bodyZ,
    agreementTemplateVersion: templateVersionZ.optional(),
  })
  .strict();

export type UpdateRentalAgreementInput = z.infer<typeof updateRentalAgreementSchema>;

export const signRentalAgreementSchema = z
  .object({
    signedByName: z.string().min(1).max(200).trim(),
  })
  .strict();

export type SignRentalAgreementInput = z.infer<typeof signRentalAgreementSchema>;

const presignMime = z.enum([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const agreementAttachmentPresignBodySchema = z
  .object({
    originalName: z.string().min(1).max(200),
    mimeType: presignMime,
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  })
  .strict();

export type AgreementAttachmentPresignBody = z.infer<typeof agreementAttachmentPresignBodySchema>;
