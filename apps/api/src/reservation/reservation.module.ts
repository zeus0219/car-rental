import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FleetModule } from '../fleet/fleet.module';
import { PartnerWebhookModule } from '../partner/partner-webhook.module';
import { RentalAgreementModule } from '../rental-agreement/rental-agreement.module';
import { ReservationController } from './reservation.controller';
import { ReservationOpsController } from './reservation-ops.controller';
import { ReservationOpsService } from './reservation-ops.service';
import { ReservationService } from './reservation.service';

@Module({
  imports: [AuthModule, FleetModule, RentalAgreementModule, PartnerWebhookModule],
  controllers: [ReservationOpsController, ReservationController],
  providers: [ReservationService, ReservationOpsService],
  exports: [ReservationService, ReservationOpsService],
})
export class ReservationModule {}
