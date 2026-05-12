-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('STAFF', 'PUBLIC_WEB');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "source" "ReservationSource" NOT NULL DEFAULT 'STAFF';

-- Index for desk filters / reports
CREATE INDEX "Reservation_source_idx" ON "Reservation"("source");
