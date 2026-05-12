-- CreateEnum
CREATE TYPE "CargosEnvironment" AS ENUM ('TEST', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CargosAdapter" AS ENUM ('MOCK', 'HTTP', 'OFF');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "cargosInScope" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN "cargosEnvironment" "CargosEnvironment" NOT NULL DEFAULT 'TEST';
ALTER TABLE "Company" ADD COLUMN "cargosAdapter" "CargosAdapter" NOT NULL DEFAULT 'MOCK';
ALTER TABLE "Company" ADD COLUMN "cargosHttpUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN "cargosCutoffMinutesBeforePickup" INTEGER;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN "cargosLocationCode" TEXT;

-- AlterTable
ALTER TABLE "CargosSubmission" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- AlterEnum
ALTER TYPE "CargosSubmissionStatus" ADD VALUE 'SKIPPED';
