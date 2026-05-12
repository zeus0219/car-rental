-- CreateEnum
CREATE TYPE "AgreementAttachmentStorage" AS ENUM ('LOCAL', 'S3');

-- AlterTable
ALTER TABLE "RentalAgreementAttachment" ADD COLUMN "storage" "AgreementAttachmentStorage" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "RentalAgreementAttachment" ADD COLUMN "uploadCompletedAt" TIMESTAMP(3);

-- Existing rows are fully uploaded local files
UPDATE "RentalAgreementAttachment" SET "uploadCompletedAt" = "createdAt" WHERE "uploadCompletedAt" IS NULL;
