import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalendarBlockController } from './calendar-block/calendar-block.controller';
import { CalendarBlockService } from './calendar-block/calendar-block.service';
import { AvailabilityController } from './availability/availability.controller';
import { AvailabilityService } from './availability/availability.service';
import { VehicleClassController } from './vehicle-class/vehicle-class.controller';
import { VehicleClassService } from './vehicle-class/vehicle-class.service';
import { VehicleController } from './vehicle/vehicle.controller';
import { VehicleService } from './vehicle/vehicle.service';

@Module({
  imports: [AuthModule],
  controllers: [
    VehicleClassController,
    VehicleController,
    CalendarBlockController,
    AvailabilityController,
  ],
  providers: [VehicleClassService, VehicleService, CalendarBlockService, AvailabilityService],
  exports: [AvailabilityService],
})
export class FleetModule {}
