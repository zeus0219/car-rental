import { Controller, Headers, Post, Body, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { customerDocumentOcrAsyncCompletionBodySchema } from '@car-rental/shared';
import { Public } from '../auth/public.decorator';
import { CustomerDocumentService } from '../organization/customer/customer-document.service';
import { PartnerWebhookService } from '../partner/partner-webhook.service';
import { CustomerDocumentOcrCronService } from './customer-document-ocr-cron.service';
import { RentReminderService } from './rent-reminder.service';
import { ServiceDueBlockService } from './service-due-block.service';

@ApiTags('Integrations')
@Controller('internal/cron')
export class InternalCronController {
  constructor(
    private readonly config: ConfigService,
    private readonly rentReminders: RentReminderService,
    private readonly serviceDueBlocks: ServiceDueBlockService,
    private readonly customerDocOcr: CustomerDocumentOcrCronService,
    private readonly partnerWebhooks: PartnerWebhookService,
    private readonly customerDocuments: CustomerDocumentService,
  ) {}

  /**
   * Worker / external cron: Bearer `WORKER_INTERNAL_SECRET` (≥16 chars when set).
   * Returns counts for logs; does not expose sensitive data.
   */
  @Public()
  @Post('rent-payment-reminders')
  async rentPaymentReminders(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('WORKER_INTERNAL_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException();
    }
    const expected = `Bearer ${secret}`;
    if ((authorization ?? '').trim() !== expected) {
      throw new UnauthorizedException();
    }
    return this.rentReminders.processDueReminders();
  }

  /** F3: Bearer `WORKER_INTERNAL_SECRET` — creates MAINTENANCE `CalendarBlock` rows when service due + configured. */
  @Public()
  @Post('service-due-maintenance-blocks')
  async serviceDueMaintenanceBlocks(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('WORKER_INTERNAL_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException();
    }
    const expected = `Bearer ${secret}`;
    if ((authorization ?? '').trim() !== expected) {
      throw new UnauthorizedException();
    }
    return this.serviceDueBlocks.processDueAutoBlocks();
  }

  /** G3: `CUSTOMER_DOCUMENT_OCR_AUTO=mock|http` — turns `PENDING` docs into `READY` suggestions (mock or HTTP vendor). */
  @Public()
  @Post('customer-document-ocr')
  @ApiOperation({
    summary: 'Process pending customer-document OCR queue — mock or HTTP adapter (Bearer WORKER_INTERNAL_SECRET)',
  })
  async customerDocumentOcr(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('WORKER_INTERNAL_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException();
    }
    const expected = `Bearer ${secret}`;
    if ((authorization ?? '').trim() !== expected) {
      throw new UnauthorizedException();
    }
    return this.customerDocOcr.processDueBatch();
  }

  /**
   * G3: your adapter completes OCR asynchronously — POST `suggestion` or `error` for a document still **`PENDING`**.
   * Same Bearer auth as other internal crons.
   */
  @Public()
  @Post('customer-document-ocr-callback')
  @ApiOperation({
    summary:
      'Apply async customer-document OCR result — JSON body with documentId + suggestion or error (Bearer WORKER_INTERNAL_SECRET)',
  })
  async customerDocumentOcrCallback(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = this.config.get<string>('WORKER_INTERNAL_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException();
    }
    const expected = `Bearer ${secret}`;
    if ((authorization ?? '').trim() !== expected) {
      throw new UnauthorizedException();
    }
    const data = customerDocumentOcrAsyncCompletionBodySchema.parse(body);
    return this.customerDocuments.completeOcrFromAsyncWorker(data);
  }

  /** G2: deliver queued partner `reservation.created` webhooks (Bearer `WORKER_INTERNAL_SECRET`). */
  @Public()
  @Post('partner-webhook-deliveries')
  @ApiOperation({
    summary:
      'Process partner webhook delivery queue — HTTPS POST + HMAC (Bearer WORKER_INTERNAL_SECRET)',
  })
  async partnerWebhookDeliveries(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('WORKER_INTERNAL_SECRET')?.trim() ?? '';
    if (!secret || secret.length < 16) {
      throw new UnauthorizedException();
    }
    const expected = `Bearer ${secret}`;
    if ((authorization ?? '').trim() !== expected) {
      throw new UnauthorizedException();
    }
    return this.partnerWebhooks.processDueDeliveriesBatch();
  }
}
