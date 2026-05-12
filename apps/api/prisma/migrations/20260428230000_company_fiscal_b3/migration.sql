-- B3: Italian fiscal fields on Company (lessor) for invoicing / SDI context

ALTER TABLE "Company" ADD COLUMN "fiscalCode" VARCHAR(32);
ALTER TABLE "Company" ADD COLUMN "vatNumber" VARCHAR(20);
ALTER TABLE "Company" ADD COLUMN "sdiRecipientCode" VARCHAR(10);
ALTER TABLE "Company" ADD COLUMN "pec" VARCHAR(320);
