import { z } from 'zod';

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
  cargosLocationCode: z.string().max(32).optional().nullable(),
});

export type CreateStationInput = z.infer<typeof createStationSchema>;

export const updateStationSchema = createStationSchema.partial().omit({ companyId: true });

export type UpdateStationInput = z.infer<typeof updateStationSchema>;
