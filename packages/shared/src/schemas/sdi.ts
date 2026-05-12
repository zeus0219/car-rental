import { z } from 'zod';

export const sdiAdapterValues = ['OFF', 'MOCK', 'HTTP'] as const;
export type SdiAdapter = (typeof sdiAdapterValues)[number];

export const sdiEnqueueBodySchema = z
  .object({
    invoiceId: z.string().uuid(),
  })
  .strict();

export type SdiEnqueueBody = z.infer<typeof sdiEnqueueBodySchema>;

/** E4: middleware calls back when async SDI / certified path completes (Bearer `SDI_CALLBACK_SECRET`). */
export const sdiCallbackBodySchema = z
  .object({
    submissionId: z.string().uuid(),
    status: z.enum(['SENT', 'FAILED']),
    idTracciatura: z.string().max(120).optional(),
    errorMessage: z.string().max(2000).optional(),
  })
  .strict();

export type SdiCallbackBody = z.infer<typeof sdiCallbackBodySchema>;
