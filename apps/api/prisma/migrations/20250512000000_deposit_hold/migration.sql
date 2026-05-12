-- CreateEnum
CREATE TYPE "DepositHoldStatus" AS ENUM ('NONE', 'PENDING', 'UNCAPTURED', 'CAPTURED', 'CANCELED', 'FAILED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "stripeDepositCheckoutSessionId" TEXT,
ADD COLUMN     "stripeDepositPaymentIntentId" TEXT,
ADD COLUMN     "depositHoldCents" INTEGER,
ADD COLUMN     "depositHoldStatus" "DepositHoldStatus" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_stripeDepositCheckoutSessionId_key" ON "Reservation"("stripeDepositCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_stripeDepositPaymentIntentId_key" ON "Reservation"("stripeDepositPaymentIntentId");
