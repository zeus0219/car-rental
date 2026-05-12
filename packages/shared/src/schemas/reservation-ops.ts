import { z } from 'zod';

/** Default handover/return checklist rows (F1) — client merges with `ok` per reservation */
export const defaultOpsChecklistTemplate: readonly { key: string; label: string }[] = [
  { key: 'exterior', label: 'Exterior, lights, glass' },
  { key: 'tires', label: 'Tires & wheels' },
  { key: 'interior', label: 'Interior & accessories' },
  { key: 'docs', label: 'Documents & vehicle keys' },
  { key: 'fuel', label: 'Fuel level agreed / noted' },
] as const;

export const opsChecklistItemSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  ok: z.boolean(),
});

export const reservationOpsChecklistSchema = z.object({
  items: z.array(opsChecklistItemSchema).max(40),
});

export type ReservationOpsChecklist = z.infer<typeof reservationOpsChecklistSchema>;

export const putReservationDamageBodySchema = z
  .object({
    status: z.enum(['DRAFT', 'CLOSED']),
    notes: z.string().max(8000).nullable().optional(),
    suggestedCaptureCents: z.number().int().min(0).nullable().optional(),
    lines: z
      .array(
        z.object({
          area: z.string().min(1).max(200),
          description: z.string().min(1).max(4000),
          estimatedFeeCents: z.number().int().min(0).nullable().optional(),
        }),
      )
      .max(50),
  })
  .strict();

export type PutReservationDamageInput = z.infer<typeof putReservationDamageBodySchema>;

export const reservationOperationPhotoPresignBodySchema = z
  .object({
    phase: z.enum(['HANDOVER', 'RETURN']),
    originalName: z.string().min(1).max(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  })
  .strict();

export const damageReportPhotoPresignBodySchema = z
  .object({
    originalName: z.string().min(1).max(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  })
  .strict();
