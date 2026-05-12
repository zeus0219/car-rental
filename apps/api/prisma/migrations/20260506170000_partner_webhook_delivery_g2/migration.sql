-- G2: queued partner outbound webhooks (reservation.created) with retries + delivery metadata
CREATE TYPE "PartnerWebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD');

CREATE TABLE "PartnerWebhookDelivery" (
    "id" TEXT NOT NULL,
    "partnerApiKeyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "status" "PartnerWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerWebhookDelivery_status_nextAttemptAt_idx" ON "PartnerWebhookDelivery"("status", "nextAttemptAt");

CREATE INDEX "PartnerWebhookDelivery_partnerApiKeyId_idx" ON "PartnerWebhookDelivery"("partnerApiKeyId");

CREATE INDEX "PartnerWebhookDelivery_reservationId_idx" ON "PartnerWebhookDelivery"("reservationId");

ALTER TABLE "PartnerWebhookDelivery" ADD CONSTRAINT "PartnerWebhookDelivery_partnerApiKeyId_fkey" FOREIGN KEY ("partnerApiKeyId") REFERENCES "PartnerApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerWebhookDelivery" ADD CONSTRAINT "PartnerWebhookDelivery_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
