import { z } from 'zod';

/** G2: partner may cancel via PATCH with this body only (v1). */
export const partnerCancelReservationBodySchema = z
  .object({ status: z.literal('CANCELLED') })
  .strict();

export type PartnerCancelReservationBody = z.infer<typeof partnerCancelReservationBodySchema>;
