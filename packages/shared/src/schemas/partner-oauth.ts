import { z } from 'zod';

/** RFC 6749-style client_credentials (JSON body on `POST /v1/partner/oauth/token`). */
export const partnerOAuthTokenRequestSchema = z
  .object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().uuid(),
    client_secret: z.string().min(8).max(512),
  })
  .strict();

export type PartnerOAuthTokenRequest = z.infer<typeof partnerOAuthTokenRequestSchema>;
