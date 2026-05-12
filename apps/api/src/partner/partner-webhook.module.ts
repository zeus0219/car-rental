import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartnerWebhookService } from './partner-webhook.service';

@Module({
  imports: [PrismaModule],
  providers: [PartnerWebhookService],
  exports: [PartnerWebhookService],
})
export class PartnerWebhookModule {}
