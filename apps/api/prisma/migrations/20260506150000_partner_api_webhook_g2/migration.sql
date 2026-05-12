-- G2: optional outbound webhook URL + HMAC signing secret per partner API key
ALTER TABLE "PartnerApiKey" ADD COLUMN "webhookUrl" VARCHAR(2048);
ALTER TABLE "PartnerApiKey" ADD COLUMN "webhookSigningSecret" VARCHAR(512);
