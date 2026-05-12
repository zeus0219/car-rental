import { join } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './throttler/redis-throttler.storage';
import { AuditController } from './audit/audit.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { FleetModule } from './fleet/fleet.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { OrganizationModule } from './organization/organization.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationModule } from './reservation/reservation.module';
import { PricingModule } from './pricing/pricing.module';
import { PaymentsModule } from './payments/payments.module';
import { RentalAgreementModule } from './rental-agreement/rental-agreement.module';
import { CargosModule } from './integrations/cargos/cargos.module';
import { SdiModule } from './integrations/sdi/sdi.module';
import { PublicModule } from './public/public.module';
import { MailModule } from './mail/mail.module';
import { SmsModule } from './sms/sms.module';
import { InvoiceModule } from './invoice/invoice.module';
import { ReportsModule } from './reports/reports.module';
import { InternalModule } from './internal/internal.module';
import { PartnerModule } from './partner/partner.module';
import { validateEnv } from './config/env.validation';

/** When cwd is the monorepo root, default `.env` cwd lookup is wrong. Nest merges files so earlier paths win on duplicate keys — list api first, then optional root. */
const envFiles = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '..', '..', '.env'),
];

@Module({
  controllers: [AuditController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFiles,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const log = new Logger('Throttler');
        const throttlers = [{ name: 'default', ttl: 60_000, limit: 200 }] as const;
        const redisUrl = config.get<string>('REDIS_URL')?.trim();
        if (redisUrl) {
          log.log('HTTP rate limits: Redis storage (A6 — shared across multiple API replicas)');
          return { throttlers: [...throttlers], storage: new RedisThrottlerStorage(redisUrl) };
        }
        log.log('HTTP rate limits: in-memory (single API instance; set REDIS_URL when scaling out)');
        return { throttlers: [...throttlers] };
      },
    }),
    PrismaModule,
    MailModule,
    SmsModule,
    MetricsModule,
    AuditModule,
    AuthModule,
    HealthModule,
    OrganizationModule,
    FleetModule,
    PricingModule,
    PaymentsModule,
    RentalAgreementModule,
    CargosModule,
    SdiModule,
    PublicModule,
    InternalModule,
    ReservationModule,
    PartnerModule,
    InvoiceModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
