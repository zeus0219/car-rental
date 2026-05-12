-- E4: SDI adapter on Company + SdiInvoiceSubmission (MOCK/HTTP; not Agenzia portale in v1)

CREATE TYPE "SdiAdapter" AS ENUM ('OFF', 'MOCK', 'HTTP');
CREATE TYPE "SdiSubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'MOCK_SENT', 'SKIPPED', 'FAILED', 'SENT');

ALTER TABLE "Company" ADD COLUMN "sdiAdapter" "SdiAdapter" NOT NULL DEFAULT 'OFF';
ALTER TABLE "Company" ADD COLUMN "sdiHttpUrl" TEXT;

CREATE TABLE "SdiInvoiceSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "SdiSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "idTracciatura" VARCHAR(120),
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SdiInvoiceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SdiInvoiceSubmission_companyId_status_idx" ON "SdiInvoiceSubmission"("companyId", "status");
CREATE INDEX "SdiInvoiceSubmission_invoiceId_createdAt_idx" ON "SdiInvoiceSubmission"("invoiceId", "createdAt");

ALTER TABLE "SdiInvoiceSubmission" ADD CONSTRAINT "SdiInvoiceSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdiInvoiceSubmission" ADD CONSTRAINT "SdiInvoiceSubmission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
