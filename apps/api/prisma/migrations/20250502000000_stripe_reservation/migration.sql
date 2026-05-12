-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_stripeCheckoutSessionId_key" ON "Reservation"("stripeCheckoutSessionId");
