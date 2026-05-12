import { z } from 'zod';

export const anonymizeCustomerBodySchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

export type AnonymizeCustomerBody = z.infer<typeof anonymizeCustomerBodySchema>;
