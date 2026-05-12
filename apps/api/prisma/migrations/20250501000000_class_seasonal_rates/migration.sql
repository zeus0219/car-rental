-- CreateTable
CREATE TABLE "VehicleClassSeasonalRate" (
    "id" TEXT NOT NULL,
    "vehicleClassId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "dailyCents" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleClassSeasonalRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleClassSeasonalRate_vehicleClassId_idx" ON "VehicleClassSeasonalRate"("vehicleClassId");

-- AddForeignKey
ALTER TABLE "VehicleClassSeasonalRate" ADD CONSTRAINT "VehicleClassSeasonalRate_vehicleClassId_fkey" FOREIGN KEY ("vehicleClassId") REFERENCES "VehicleClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
