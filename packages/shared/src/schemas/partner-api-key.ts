import { z } from 'zod';

export const createPartnerApiKeySchema = z.object({
  name: z.string().min(1).max(120).trim(),
});

export type CreatePartnerApiKeyInput = z.infer<typeof createPartnerApiKeySchema>;

const webhookUrlField = z
  .string()
  .max(2048)
  .refine((s) => s === '' || /^https:\/\/.+/i.test(s), {
    message: 'webhookUrl must be empty or an https URL',
  });

/** PATCH: set `webhookUrl` / `webhookSigningSecret`; use empty string to clear. Omit a field to leave it unchanged. */
export const patchPartnerApiKeyWebhookSchema = z
  .object({
    webhookUrl: webhookUrlField.optional(),
    webhookSigningSecret: z.union([z.literal(''), z.string().min(8).max(512)]).optional(),
  })
  .refine((d) => d.webhookUrl !== undefined || d.webhookSigningSecret !== undefined, {
    message: 'At least one of webhookUrl or webhookSigningSecret is required',
  });

export type PatchPartnerApiKeyWebhookInput = z.infer<typeof patchPartnerApiKeyWebhookSchema>;

/** PATCH: per-key IPv4 allowlist (comma-separated IPs / `a.b.c.d/nn`); empty string clears. See `PARTNER_API_ALLOWED_IP_CIDRS` (both apply when set). */
export const patchPartnerApiKeyAllowedIpCidrsSchema = z
  .object({
    allowedIpCidrs: z.string().max(8000),
  })
  .strict();

export type PatchPartnerApiKeyAllowedIpCidrsInput = z.infer<typeof patchPartnerApiKeyAllowedIpCidrsSchema>;
