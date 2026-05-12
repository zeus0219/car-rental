import { z } from 'zod';

export const createVehicleClassSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i, 'alphanumeric, underscore, hyphen'),
  defaultDailyCents: z.number().int().min(0).optional(),
  defaultDepositCents: z.number().int().min(0).optional(),
});

export type CreateVehicleClassInput = z.infer<typeof createVehicleClassSchema>;

export const updateVehicleClassSchema = createVehicleClassSchema.partial().omit({ companyId: true });

export type UpdateVehicleClassInput = z.infer<typeof updateVehicleClassSchema>;
