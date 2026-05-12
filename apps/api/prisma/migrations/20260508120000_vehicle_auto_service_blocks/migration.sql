-- F3: optional auto maintenance window (CalendarBlock) when odometer reaches nextServiceDueOdometerKm
ALTER TABLE "Vehicle" ADD COLUMN "autoServiceBlockHours" INTEGER;
ALTER TABLE "Vehicle" ADD COLUMN "serviceDueAutoBlockedForKm" INTEGER;
