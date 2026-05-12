-- CreateTable
CREATE TABLE "RentalAgreementAttachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rentalAgreementId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalAgreementAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreementAttachment_storageKey_key" ON "RentalAgreementAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "RentalAgreementAttachment_rentalAgreementId_idx" ON "RentalAgreementAttachment"("rentalAgreementId");

-- CreateIndex
CREATE INDEX "RentalAgreementAttachment_companyId_idx" ON "RentalAgreementAttachment"("companyId");

-- AddForeignKey
ALTER TABLE "RentalAgreementAttachment" ADD CONSTRAINT "RentalAgreementAttachment_rentalAgreementId_fkey" FOREIGN KEY ("rentalAgreementId") REFERENCES "RentalAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreementAttachment" ADD CONSTRAINT "RentalAgreementAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
