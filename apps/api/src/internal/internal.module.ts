import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { PartnerWebhookModule } from '../partner/partner-webhook.module';
import { CustomerDocumentOcrCronService } from './customer-document-ocr-cron.service';
import { InternalCronController } from './internal-cron.controller';
import { RentReminderService } from './rent-reminder.service';
import { ServiceDueBlockService } from './service-due-block.service';

@Module({
  imports: [OrganizationModule, PartnerWebhookModule],
  controllers: [InternalCronController],
  providers: [RentReminderService, ServiceDueBlockService, CustomerDocumentOcrCronService],
})
export class InternalModule {}
