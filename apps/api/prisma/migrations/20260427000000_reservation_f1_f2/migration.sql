-- F1 / F2: handover/return ops + damage (PRODUCTION-READINESS step 10)

-- CreateEnum
CREATE TYPE "ReservationPhotoPhase" AS ENUM ('HANDOVER', 'RETURN');

-- CreateEnum
CREATE TYPE "DamageReportStatus" AS ENUM ('DRAFT', 'CLOSED');

-- AlterTable Reservation
ALTER TABLE "Reservation" ADD COLUMN "fuelOutPercent" INTEGER;
ALTER TABLE "Reservation" ADD COLUMN "fuelInPercent" INTEGER;
ALTER TABLE "Reservation" ADD COLUMN "handoverChecklistJson" JSONB;
ALTER TABLE "Reservation" ADD COLUMN "returnChecklistJson" JSONB;
ALTER TABLE "Reservation" ADD COLUMN "handoverOpsNotes" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "returnOpsNotes" TEXT;

-- CreateTable
CREATE TABLE "ReservationOperationPhoto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "phase" "ReservationPhotoPhase" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storage" "AgreementAttachmentStorage" NOT NULL DEFAULT 'LOCAL',
    "uploadCompletedAt" TIMESTAMP(3),
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReservationOperationPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationOperationPhoto_storageKey_key" ON "ReservationOperationPhoto"("storageKey");
CREATE INDEX "ReservationOperationPhoto_reservationId_phase_idx" ON "ReservationOperationPhoto"("reservationId", "phase");
CREATE INDEX "ReservationOperationPhoto_companyId_idx" ON "ReservationOperationPhoto"("companyId");
ALTER TABLE "ReservationOperationPhoto" ADD CONSTRAINT "ReservationOperationPhoto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationOperationPhoto" ADD CONSTRAINT "ReservationOperationPhoto_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationOperationPhoto" ADD CONSTRAINT "ReservationOperationPhoto_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable DamageReport
CREATE TABLE "DamageReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" "DamageReportStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "suggestedCaptureCents" INTEGER,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DamageReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DamageReport_reservationId_key" ON "DamageReport"("reservationId");
CREATE INDEX "DamageReport_companyId_idx" ON "DamageReport"("companyId");
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DamageLine
CREATE TABLE "DamageLine" (
    "id" TEXT NOT NULL,
    "damageReportId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedFeeCents" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DamageLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DamageLine_damageReportId_idx" ON "DamageLine"("damageReportId");
ALTER TABLE "DamageLine" ADD CONSTRAINT "DamageLine_damageReportId_fkey" FOREIGN KEY ("damageReportId") REFERENCES "DamageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable DamageReportPhoto
CREATE TABLE "DamageReportPhoto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "damageReportId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storage" "AgreementAttachmentStorage" NOT NULL DEFAULT 'LOCAL',
    "uploadCompletedAt" TIMESTAMP(3),
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DamageReportPhoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DamageReportPhoto_storageKey_key" ON "DamageReportPhoto"("storageKey");
CREATE INDEX "DamageReportPhoto_damageReportId_idx" ON "DamageReportPhoto"("damageReportId");
CREATE INDEX "DamageReportPhoto_companyId_idx" ON "DamageReportPhoto"("companyId");
ALTER TABLE "DamageReportPhoto" ADD CONSTRAINT "DamageReportPhoto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DamageReportPhoto" ADD CONSTRAINT "DamageReportPhoto_damageReportId_fkey" FOREIGN KEY ("damageReportId") REFERENCES "DamageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DamageReportPhoto" ADD CONSTRAINT "DamageReportPhoto_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
