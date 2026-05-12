import { z } from 'zod';

const isoDateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T12:00:00.000Z`);
    return !Number.isNaN(d.getTime());
  }, 'invalid calendar date');

export const vehicleClassSeasonalRateItemSchema = z
  .object({
    validFrom: isoDateStr,
    validTo: isoDateStr,
    dailyCents: z.number().int().min(0),
    priority: z.number().int().min(0).default(0),
  })
  .refine(
    (r) => {
      if (r.validFrom > r.validTo) {
        return false;
      }
      return true;
    },
    { message: 'validFrom must be on or before validTo' },
  );

export const putVehicleClassSeasonalRatesBodySchema = z.object({
  rates: z.array(vehicleClassSeasonalRateItemSchema).max(48),
});

export type PutVehicleClassSeasonalRatesInput = z.infer<typeof putVehicleClassSeasonalRatesBodySchema>;
