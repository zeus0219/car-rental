import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReservationModule } from '../reservation/reservation.module';
import { CompanyPartnerApiKeysController } from './company-partner-api-keys.controller';
import { PartnerApiKeyService } from './partner-api-key.service';
import { PartnerKeyGuard } from './partner-key.guard';
import { PartnerOauthController } from './partner-oauth.controller';
import { PartnerOauthService } from './partner-oauth.service';
import { PartnerReservationsController } from './partner-reservations.controller';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, ReservationModule],
  controllers: [PartnerReservationsController, PartnerOauthController, CompanyPartnerApiKeysController],
  providers: [PartnerApiKeyService, PartnerKeyGuard, PartnerOauthService],
  exports: [PartnerApiKeyService],
})
export class PartnerModule {}
