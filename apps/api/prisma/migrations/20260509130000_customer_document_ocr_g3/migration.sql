-- G3: OCR suggestions (human confirmation required before customer profile updates)
CREATE TYPE "CustomerDocumentOcrStatus" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

ALTER TABLE "CustomerDocument" ADD COLUMN "ocrStatus" "CustomerDocumentOcrStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrSuggestionJson" JSONB;
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrCompletedAt" TIMESTAMP(3);
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrVendor" VARCHAR(64);
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrError" TEXT;
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrAppliedAt" TIMESTAMP(3);
ALTER TABLE "CustomerDocument" ADD COLUMN "ocrAppliedByUserId" TEXT;

CREATE INDEX "CustomerDocument_ocrStatus_idx" ON "CustomerDocument"("ocrStatus");

ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_ocrAppliedByUserId_fkey" FOREIGN KEY ("ocrAppliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
