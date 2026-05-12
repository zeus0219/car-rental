import { z } from 'zod';

/** Object shape (before one-way field refinement); use for `.extend()` in public query schema */
export const rateQuoteQueryObjectSchema = z.object({
  vehicleClassId: z.string().uuid(),
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  /** Both required together when computing one-way fee */
  pickupStationId: z.string().uuid().optional(),
  returnStationId: z.string().uuid().optional(),
});

export const rateQuoteQuerySchema = rateQuoteQueryObjectSchema.refine(
  (q) => (q.pickupStationId == null) === (q.returnStationId == null),
  {
    message: 'pickupStationId and returnStationId must both be set or both omitted',
    path: ['pickupStationId'],
  },
);

export type RateQuoteQuery = z.infer<typeof rateQuoteQuerySchema>;
