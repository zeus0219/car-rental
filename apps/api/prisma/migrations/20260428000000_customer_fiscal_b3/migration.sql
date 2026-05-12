-- B3: Italian fiscal fields on Customer (PRODUCTION-READINESS step 11)

ALTER TABLE "Customer" ADD COLUMN "fiscalCode" VARCHAR(32);
ALTER TABLE "Customer" ADD COLUMN "vatNumber" VARCHAR(20);
ALTER TABLE "Customer" ADD COLUMN "sdiRecipientCode" VARCHAR(10);
ALTER TABLE "Customer" ADD COLUMN "pec" VARCHAR(320);
