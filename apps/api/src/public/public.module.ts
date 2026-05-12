import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FleetModule } from '../fleet/fleet.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReservationModule } from '../reservation/reservation.module';
import { PublicCatalogService } from './public-catalog.service';
import { PublicController } from './public.controller';

@Module({
  imports: [PrismaModule, FleetModule, PricingModule, ReservationModule],
  controllers: [PublicController],
  providers: [PublicCatalogService],
})
export class PublicModule {}
