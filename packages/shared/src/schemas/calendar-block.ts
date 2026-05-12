import { z } from 'zod';

export const calendarBlockTypeValues = ['MAINTENANCE', 'BUFFER', 'HOLD', 'OTHER'] as const;

export const createCalendarBlockSchema = z.object({
  vehicleId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  type: z.enum(calendarBlockTypeValues).optional(),
  reason: z.string().max(500).optional(),
});

export type CreateCalendarBlockInput = z.infer<typeof createCalendarBlockSchema>;

export const updateCalendarBlockSchema = z
  .object({
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    type: z.enum(calendarBlockTypeValues).optional(),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();

export type UpdateCalendarBlockInput = z.infer<typeof updateCalendarBlockSchema>;
