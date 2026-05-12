import { z } from 'zod';
import { reservationOpsChecklistSchema } from './reservation-ops';

/**
 * How the reservation was first created (set only by the API; not editable by clients in v1).
 */
export const reservationSourceValues = ['STAFF', 'PUBLIC_WEB', 'PARTNER'] as const;
export type ReservationSource = (typeof reservationSourceValues)[number];

/**
 * Terminal / inactive — do not block inventory (half-open [pickup, return) no longer "held")
 */
export const reservationNonBlockingStatusValues = ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;

export const reservationStatusValues = [
  'QUOTE',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
] as const;

export const reservationExtraLineItemSchema = z.object({
  label: z.string().min(1).max(200),
  amountCents: z.number().int().min(0),
});

export const createReservationSchema = z
  .object({
    companyId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    pickupStationId: z.string().uuid(),
    returnStationId: z.string().uuid(),
    pickupAt: z.coerce.date(),
    returnAt: z.coerce.date(),
    status: z.enum(reservationStatusValues).optional(),
    /** When set, contact fields default from this customer; optional overrides per field */
    customerId: z.string().uuid().optional(),
    customerName: z.string().min(1).max(200).optional(),
    customerEmail: z.string().email().max(320).optional(),
    customerPhone: z.string().min(3).max(40).optional(),
    totalCents: z.number().int().min(0).optional(),
    currency: z.string().length(3).default('EUR'),
    notes: z.string().max(2000).optional(),
    extraLines: z.array(reservationExtraLineItemSchema).max(40).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.customerId && (!d.customerName || !d.customerEmail || !d.customerPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide customerId or all of customerName, customerEmail, and customerPhone',
        path: ['customerName'],
      });
    }
  })
  .refine(
    (d) =>
      d.totalCents === undefined ||
      !d.extraLines ||
      d.extraLines.length === 0,
    {
      path: ['extraLines'],
      message:
        'Omit totalCents to use auto total (rent + one-way + extras), or do not add extra line items with a manual total',
    },
  );

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationSchema = z
  .object({
    vehicleId: z.string().uuid().optional(),
    pickupStationId: z.string().uuid().optional(),
    returnStationId: z.string().uuid().optional(),
    pickupAt: z.coerce.date().optional(),
    returnAt: z.coerce.date().optional(),
    status: z.enum(reservationStatusValues).optional(),
    customerId: z.string().uuid().nullable().optional(),
    customerName: z.string().min(1).max(200).optional(),
    customerEmail: z.string().email().max(320).optional(),
    customerPhone: z.string().min(3).max(40).optional(),
    totalCents: z.number().int().min(0).nullable().optional(),
    currency: z.string().length(3).optional(),
    notes: z.string().max(2000).nullable().optional(),
    extraLines: z.array(reservationExtraLineItemSchema).max(40).nullable().optional(),
    odometerOutKm: z.number().int().min(0).nullable().optional(),
    odometerInKm: z.number().int().min(0).nullable().optional(),
    /// F1: fuel gauge 0–100
    fuelOutPercent: z.number().int().min(0).max(100).nullable().optional(),
    fuelInPercent: z.number().int().min(0).max(100).nullable().optional(),
    handoverChecklist: reservationOpsChecklistSchema.nullable().optional(),
    returnChecklist: reservationOpsChecklistSchema.nullable().optional(),
    handoverOpsNotes: z.string().max(8000).nullable().optional(),
    returnOpsNotes: z.string().max(8000).nullable().optional(),
    /** Set a reason (ADMIN/BRANCH only) to allow handover without successful CaRGOS, or `null` to clear. */
    cargosHandoverOverride: z
      .union([z.object({ reason: z.string().min(1).max(2000).trim() }), z.null()])
      .optional(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.totalCents === undefined) {
        return true;
      }
      if (d.extraLines === undefined || d.extraLines === null) {
        return true;
      }
      return d.extraLines.length === 0;
    },
    {
      path: ['extraLines'],
      message:
        'Omit totalCents when adding extra line items; you may set totalCents with empty or omitted extra lines',
    },
  )
  .superRefine((d, ctx) => {
    if (
      d.odometerOutKm != null &&
      d.odometerInKm != null &&
      d.odometerInKm < d.odometerOutKm
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'odometerInKm must be greater than or equal to odometerOutKm when both are set',
        path: ['odometerInKm'],
      });
    }
  });

export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

/** Response shape for GET /v1/reservations/summary */
export type ReservationCompanySummary = {
  companyId: string;
  byStatus: Record<(typeof reservationStatusValues)[number], number>;
  publicWebOpenQuotes: number;
  upcomingPickupsNext7Days: number;
};
