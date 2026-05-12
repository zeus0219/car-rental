-- CreateEnum
CREATE TYPE "CargosSubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'MOCK_SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CargosSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "status" "CargosSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargosSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CargosSubmission_companyId_status_idx" ON "CargosSubmission"("companyId", "status");

-- CreateIndex
CREATE INDEX "CargosSubmission_reservationId_createdAt_idx" ON "CargosSubmission"("reservationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CargosSubmission" ADD CONSTRAINT "CargosSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CargosSubmission" ADD CONSTRAINT "CargosSubmission_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
