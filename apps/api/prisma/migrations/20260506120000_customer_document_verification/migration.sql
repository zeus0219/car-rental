-- B2: staff verification on KYC documents (optional stricter handover via HANDOVER_REQUIRE_VERIFIED_ID_DOCUMENTS)

ALTER TABLE "CustomerDocument" ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedByUserId" TEXT;

ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CustomerDocument_verifiedByUserId_idx" ON "CustomerDocument"("verifiedByUserId");
