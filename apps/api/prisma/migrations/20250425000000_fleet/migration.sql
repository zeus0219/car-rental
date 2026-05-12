-- Enums
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'SCOOTER', 'VAN', 'OTHER');
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'RENTED', 'MAINTENANCE', 'OUT_OF_FLEET', 'TRANSIT');
CREATE TYPE "CalendarBlockType" AS ENUM ('MAINTENANCE', 'BUFFER', 'HOLD', 'OTHER');

-- VehicleClass
CREATE TABLE "VehicleClass" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleClass_pkey" PRIMARY KEY ("id")
);

-- Vehicle
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vehicleClassId" TEXT NOT NULL,
    "homeStationId" TEXT NOT NULL,
    "vin" TEXT,
    "licensePlate" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "fuelType" TEXT,
    "modelLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CalendarBlock
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "type" "CalendarBlockType" NOT NULL DEFAULT 'MAINTENANCE',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleClass_companyId_code_key" ON "VehicleClass"("companyId", "code");
CREATE INDEX "VehicleClass_companyId_idx" ON "VehicleClass"("companyId");

CREATE UNIQUE INDEX "Vehicle_companyId_licensePlate_key" ON "Vehicle"("companyId", "licensePlate");
CREATE INDEX "Vehicle_companyId_idx" ON "Vehicle"("companyId");
CREATE INDEX "Vehicle_vehicleClassId_idx" ON "Vehicle"("vehicleClassId");
CREATE INDEX "Vehicle_homeStationId_idx" ON "Vehicle"("homeStationId");

CREATE INDEX "CalendarBlock_vehicleId_idx" ON "CalendarBlock"("vehicleId");
CREATE INDEX "CalendarBlock_startsAt_endsAt_idx" ON "CalendarBlock"("startsAt", "endsAt");

ALTER TABLE "VehicleClass" ADD CONSTRAINT "VehicleClass_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "VehicleClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_homeStationId_fkey" FOREIGN KEY ("homeStationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
