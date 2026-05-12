-- AlterTable
ALTER TABLE "RentalAgreement" ADD COLUMN "agreementTemplateVersion" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "signedClientIp" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "signedUserAgent" TEXT;
