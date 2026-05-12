-- Per-vehicle rent override: class default, fixed €/day, or flat trip total

CREATE TYPE "VehicleRentPricingMode" AS ENUM ('USE_CLASS', 'FIXED_DAILY', 'FLAT_TRIP');

ALTER TABLE "Vehicle" ADD COLUMN "rentPricingMode" "VehicleRentPricingMode" NOT NULL DEFAULT 'USE_CLASS',
ADD COLUMN "rentOverrideDailyCents" INTEGER,
ADD COLUMN "flatTripRentCents" INTEGER;
