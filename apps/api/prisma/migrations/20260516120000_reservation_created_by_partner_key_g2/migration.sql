-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "createdByPartnerApiKeyId" TEXT;

-- CreateIndex
CREATE INDEX "Reservation_createdByPartnerApiKeyId_idx" ON "Reservation"("createdByPartnerApiKeyId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_createdByPartnerApiKeyId_fkey" FOREIGN KEY ("createdByPartnerApiKeyId") REFERENCES "PartnerApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
