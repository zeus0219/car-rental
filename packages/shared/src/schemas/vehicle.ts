import { z } from 'zod';

export const vehicleTypeValues = ['CAR', 'SCOOTER', 'VAN', 'OTHER'] as const;
export const vehicleStatusValues = [
  'AVAILABLE',
  'RENTED',
  'MAINTENANCE',
  'OUT_OF_FLEET',
  'TRANSIT',
] as const;

export const vehicleRentPricingModeValues = ['USE_CLASS', 'FIXED_DAILY', 'FLAT_TRIP'] as const;
export type VehicleRentPricingMode = (typeof vehicleRentPricingModeValues)[number];

function refineVehicleRentPricing<
  T extends {
    rentPricingMode?: VehicleRentPricingMode;
    rentOverrideDailyCents?: number | null;
    flatTripRentCents?: number | null;
  },
>(data: T, ctx: z.RefinementCtx) {
  const mode = data.rentPricingMode ?? 'USE_CLASS';
  const o = data.rentOverrideDailyCents;
  const f = data.flatTripRentCents;
  if (mode === 'USE_CLASS') {
    if (o != null || f != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Do not set rent amounts when using class pricing',
        path: ['rentPricingMode'],
      });
    }
    return;
  }
  if (mode === 'FIXED_DAILY') {
    if (o == null || o < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FIXED_DAILY requires rentOverrideDailyCents (cents per 24h day, ≥ 0)',
        path: ['rentOverrideDailyCents'],
      });
    }
    if (f != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remove flat trip amount for FIXED_DAILY mode',
        path: ['flatTripRentCents'],
      });
    }
    return;
  }
  if (mode === 'FLAT_TRIP') {
    if (f == null || f < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FLAT_TRIP requires flatTripRentCents (gross rent for trip, ≥ 0)',
        path: ['flatTripRentCents'],
      });
    }
    if (o != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remove daily override for FLAT_TRIP mode',
        path: ['rentOverrideDailyCents'],
      });
    }
  }
}

export const createVehicleSchema = z
  .object({
    companyId: z.string().uuid(),
    vehicleClassId: z.string().uuid(),
    homeStationId: z.string().uuid(),
    licensePlate: z.string().min(1).max(20),
    vehicleType: z.enum(vehicleTypeValues),
    vin: z.string().min(1).max(32).optional(),
    status: z.enum(vehicleStatusValues).optional(),
    odometerKm: z.number().int().min(0).optional(),
    /** Purchase / fleet entry date (optional) */
    acquiredAt: z.coerce.date().optional(),
    /** Alert when current odometer reaches this km (optional) */
    nextServiceDueOdometerKm: z.number().int().min(0).optional(),
    /** F3: duration (hours) of auto-created maintenance block when due (1–336); omit to disable */
    autoServiceBlockHours: z.number().int().min(1).max(336).optional(),
    fuelType: z.string().max(40).optional(),
    modelLabel: z.string().max(200).optional(),
    coverImageUrl: z.string().url().max(2048).optional(),
    rentPricingMode: z.enum(vehicleRentPricingModeValues).optional(),
    rentOverrideDailyCents: z.number().int().min(0).nullable().optional(),
    flatTripRentCents: z.number().int().min(0).nullable().optional(),
  })
  .superRefine(refineVehicleRentPricing);

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    vehicleClassId: z.string().uuid().optional(),
    homeStationId: z.string().uuid().optional(),
    licensePlate: z.string().min(1).max(20).optional(),
    vehicleType: z.enum(vehicleTypeValues).optional(),
    vin: z.string().min(1).max(32).nullable().optional(),
    status: z.enum(vehicleStatusValues).optional(),
    odometerKm: z.number().int().min(0).optional(),
    acquiredAt: z.coerce.date().nullable().optional(),
    nextServiceDueOdometerKm: z.number().int().min(0).nullable().optional(),
    autoServiceBlockHours: z.number().int().min(1).max(336).nullable().optional(),
    fuelType: z.string().max(40).nullable().optional(),
    modelLabel: z.string().max(200).nullable().optional(),
    coverImageUrl: z.string().url().max(2048).nullable().optional(),
    rentPricingMode: z.enum(vehicleRentPricingModeValues).optional(),
    rentOverrideDailyCents: z.number().int().min(0).nullable().optional(),
    flatTripRentCents: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
