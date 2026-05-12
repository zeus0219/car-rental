-- G2: Partner B2B API keys + reservation source
ALTER TYPE "ReservationSource" ADD VALUE 'PARTNER';

CREATE TABLE "PartnerApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerApiKey_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerApiKey_companyId_idx" ON "PartnerApiKey"("companyId");

ALTER TABLE "PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
