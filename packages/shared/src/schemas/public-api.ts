import { z } from 'zod';
import { rateQuoteQueryObjectSchema } from './rate-quote';
import { reservationExtraLineItemSchema } from './reservation';

/** Cap extras on unauthenticated flows (abuse control; desk allows more). */
const publicQuoteExtraLinesSchema = z.array(reservationExtraLineItemSchema).max(12).optional();

/** Unauthenticated quote: same as desk quote but requires `companyId` to scope the tenant */
export const publicRateQuoteQuerySchema = rateQuoteQueryObjectSchema
  .extend({
    companyId: z.string().uuid(),
  })
  .refine(
    (q) => (q.pickupStationId == null) === (q.returnStationId == null),
    {
      message: 'pickupStationId and returnStationId must both be set or both omitted',
      path: ['pickupStationId'],
    },
  );

export type PublicRateQuoteQuery = z.infer<typeof publicRateQuoteQuerySchema>;

export const publicAvailabilityQuerySchema = z.object({
  companyId: z.string().uuid(),
  stationId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  vehicleClassId: z.string().uuid().optional(),
});

export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuerySchema>;

export const publicCatalogQuerySchema = z.object({
  companyId: z.string().uuid(),
});

export type PublicCatalogQuery = z.infer<typeof publicCatalogQuerySchema>;

/**
 * Unauthenticated: create a **QUOTE** draft reservation, assigning the first free vehicle of
 * the class (same home-station rule as `GET /public/availability/vehicles`).
 */
export const publicCreateQuoteBodySchema = z.object({
  companyId: z.string().uuid(),
  vehicleClassId: z.string().uuid(),
  /** Home station for class availability (must match a station where this class is offered). */
  stationId: z.string().uuid(),
  pickupStationId: z.string().uuid(),
  returnStationId: z.string().uuid(),
  pickupAt: z.coerce.date(),
  returnAt: z.coerce.date(),
  customerName: z.string().min(1).max(200),
  customerEmail: z.string().email().max(320),
  customerPhone: z.string().min(3).max(40),
  notes: z.string().max(2000).optional(),
  /** B4: required server-side when the company privacy register is non-empty; must match a `CompanyPrivacyNotice.version`. */
  privacyNoticeVersion: z.string().min(1).max(64).optional(),
  marketingEmailOptIn: z.boolean().optional().default(false),
  /** C1: optional add-ons (rent + one-way + sum(extras)); same shape as desk `extraLines`. */
  extraLines: publicQuoteExtraLinesSchema,
});

export type PublicCreateQuoteInput = z.infer<typeof publicCreateQuoteBodySchema>;

const quoteBatchLineSchema = z.object({
  vehicleClassId: z.string().uuid(),
});

/** C1: same trip + contact; each line reserves one vehicle in a distinct class (no duplicate classes). */
export const publicCreateQuoteBatchBodySchema = z
  .object({
    companyId: z.string().uuid(),
    stationId: z.string().uuid(),
    pickupStationId: z.string().uuid(),
    returnStationId: z.string().uuid(),
    pickupAt: z.coerce.date(),
    returnAt: z.coerce.date(),
    customerName: z.string().min(1).max(200),
    customerEmail: z.string().email().max(320),
    customerPhone: z.string().min(3).max(40),
    notes: z.string().max(2000).optional(),
    privacyNoticeVersion: z.string().min(1).max(64).optional(),
    marketingEmailOptIn: z.boolean().optional().default(false),
    extraLines: publicQuoteExtraLinesSchema,
    lines: z.array(quoteBatchLineSchema).min(1).max(6),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = d.lines.map((l) => l.vehicleClassId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each vehicle class may appear only once in the basket',
        path: ['lines'],
      });
    }
  });

export type PublicCreateQuoteBatchInput = z.infer<typeof publicCreateQuoteBatchBodySchema>;

/** Hex token from `randomBytes(24).toString('hex')` (48 chars) — C3 public “view my booking” link */
export const publicViewTokenParamSchema = z
  .string()
  .min(32, 'Token too short')
  .max(64, 'Token too long')
  .regex(/^[a-f0-9]+$/i, 'Invalid token format');

export const publicViewTokenQuerySchema = z.object({
  token: publicViewTokenParamSchema,
});

export type PublicViewTokenQuery = z.infer<typeof publicViewTokenQuerySchema>;

/** C3: body to receive a time-limited magic link by email (matches WEB quote email). */
export const publicRequestBookingViewLinkBodySchema = z.object({
  reservationId: z.string().uuid(),
  customerEmail: z.string().email().max(320),
});

export type PublicRequestBookingViewLinkInput = z.infer<typeof publicRequestBookingViewLinkBodySchema>;

/** HMAC guest link `rid:exp` — opaque, length varies; cap for URLs */
export const publicMagicLinkParamSchema = z
  .string()
  .min(24, 'Link invalid or expired')
  .max(2048, 'Link too long');

export const publicMagicLinkQuerySchema = z.object({
  magic: publicMagicLinkParamSchema,
});

export type PublicMagicLinkQuery = z.infer<typeof publicMagicLinkQuerySchema>;
