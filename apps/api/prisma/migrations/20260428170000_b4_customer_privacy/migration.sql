-- B4: GDPR-related customer fields (consent + anonymization)

ALTER TABLE "Customer" ADD COLUMN "privacyNoticeVersion" VARCHAR(64);
ALTER TABLE "Customer" ADD COLUMN "privacyNoticeAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "marketingEmailOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "marketingOptInAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
