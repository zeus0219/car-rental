import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RateController } from './rate.controller';
import { RateService } from './rate.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RateController],
  providers: [RateService],
  exports: [RateService],
})
export class PricingModule {}
