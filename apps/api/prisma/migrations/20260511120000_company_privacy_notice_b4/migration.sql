-- B4: company privacy notice register (counsel-approved version ids + optional URL / date / notes)
CREATE TABLE "CompanyPrivacyNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "policyUrl" VARCHAR(512),
    "effectiveFrom" DATE,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPrivacyNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPrivacyNotice_companyId_version_key" ON "CompanyPrivacyNotice"("companyId", "version");
CREATE INDEX "CompanyPrivacyNotice_companyId_idx" ON "CompanyPrivacyNotice"("companyId");

ALTER TABLE "CompanyPrivacyNotice" ADD CONSTRAINT "CompanyPrivacyNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
