-- CreateTable
CREATE TABLE "ReservationExtraLine" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationExtraLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservationExtraLine_reservationId_idx" ON "ReservationExtraLine"("reservationId");

-- AddForeignKey
ALTER TABLE "ReservationExtraLine" ADD CONSTRAINT "ReservationExtraLine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
