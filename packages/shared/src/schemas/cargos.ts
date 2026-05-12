import { z } from 'zod';

export const cargosEnqueueBodySchema = z
  .object({
    reservationId: z.string().uuid(),
    /** When true, API runs MOCK/HTTP adapter immediately (no worker wait). Still creates a submission row. */
    sendImmediately: z.boolean().optional(),
  })
  .strict();

export type CargosEnqueueBody = z.infer<typeof cargosEnqueueBodySchema>;
