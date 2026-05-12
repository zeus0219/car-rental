-- E3: invoices + per-company fiscal year sequence (non-SDI)

-- CreateSchema (enums)
CREATE TYPE "InvoiceDocumentKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "InvoiceFiscalSequence" (
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastIssued" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceFiscalSequence_pkey" PRIMARY KEY ("companyId","year")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "kind" "InvoiceDocumentKind" NOT NULL DEFAULT 'INVOICE',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "creditedInvoiceId" TEXT,
    "issueYear" INTEGER,
    "issueSequence" INTEGER,
    "documentNumber" VARCHAR(40),
    "subtotalCents" INTEGER NOT NULL,
    "vatRateBps" INTEGER NOT NULL DEFAULT 2200,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "description" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceFiscalSequence_companyId_idx" ON "InvoiceFiscalSequence"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_createdAt_idx" ON "Invoice"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_reservationId_idx" ON "Invoice"("reservationId");

-- CreateIndex
CREATE INDEX "Invoice_creditedInvoiceId_idx" ON "Invoice"("creditedInvoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceFiscalSequence" ADD CONSTRAINT "InvoiceFiscalSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditedInvoiceId_fkey" FOREIGN KEY ("creditedInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_issueYear_issueSequence_key" ON "Invoice"("companyId", "issueYear", "issueSequence");
