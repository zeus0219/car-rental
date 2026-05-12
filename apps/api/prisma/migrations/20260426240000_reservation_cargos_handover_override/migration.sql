-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "cargosHandoverOverrideAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN     "cargosHandoverOverrideById" TEXT;
ALTER TABLE "Reservation" ADD COLUMN     "cargosHandoverOverrideReason" TEXT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_cargosHandoverOverrideById_fkey" FOREIGN KEY ("cargosHandoverOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
