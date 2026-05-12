-- CreateEnum
CREATE TYPE "StripeRefundKind" AS ENUM ('RENTAL', 'DEPOSIT');

-- CreateTable
CREATE TABLE "StripeRefundLedger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "stripeRefundId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "kind" "StripeRefundKind" NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeRefundLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeRefundLedger_stripeRefundId_key" ON "StripeRefundLedger"("stripeRefundId");

-- CreateIndex
CREATE INDEX "StripeRefundLedger_companyId_createdAt_idx" ON "StripeRefundLedger"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "StripeRefundLedger_reservationId_idx" ON "StripeRefundLedger"("reservationId");

-- AddForeignKey
ALTER TABLE "StripeRefundLedger" ADD CONSTRAINT "StripeRefundLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeRefundLedger" ADD CONSTRAINT "StripeRefundLedger_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeRefundLedger" ADD CONSTRAINT "StripeRefundLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
