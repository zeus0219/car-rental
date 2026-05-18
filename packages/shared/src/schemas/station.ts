import { z } from 'zod';

/** Trim; empty string → null; max length for CaRGOS / registry-style codes. */
const cargosLocationCodeSchema = z.preprocess((val) => {
  if (val === undefined) {
    return undefined;
  }
  if (val === null) {
    return null;
  }
  const s = String(val).trim();
  return s === '' ? null : s;
}, z.union([z.string().max(32), z.null()]).optional());

export const createStationSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i, 'alphanumeric, underscore, hyphen'),
  addressLine: z.string().min(1).max(500),
  city: z.string().min(1).max(120),
  province: z.string().min(1).max(4),
  postalCode: z.string().min(1).max(10),
  country: z.string().length(2).default('IT'),
  timeZone: z.string().default('Europe/Rome'),
  cargosLocationCode: cargosLocationCodeSchema,
});

export type CreateStationInput = z.infer<typeof createStationSchema>;

export const updateStationSchema = createStationSchema.partial().omit({ companyId: true });

export type UpdateStationInput = z.infer<typeof updateStationSchema>;
