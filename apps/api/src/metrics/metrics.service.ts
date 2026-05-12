import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

const QUEUE_REFRESH_MS = 15_000;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly registry = new Registry();
  readonly httpResponsesTotal: Counter;
  readonly http5xxTotal: Counter;
  private readonly queueCargosInflight: Gauge;
  private readonly queueSdiInflight: Gauge;
  private readonly queueOcrPending: Gauge;
  private readonly queuePartnerWebhookPending: Gauge;
  private queueInterval?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    this.httpResponsesTotal = new Counter({
      name: 'car_rental_http_responses_total',
      help: 'API HTTP responses by method and status code',
      labelNames: ['method', 'status'],
      registers: [this.registry],
    });
    this.http5xxTotal = new Counter({
      name: 'car_rental_http_responses_5xx_total',
      help: 'API HTTP responses with status code >= 500',
      labelNames: ['method'],
      registers: [this.registry],
    });
    this.queueCargosInflight = new Gauge({
      name: 'car_rental_integration_queue_cargos_inflight',
      help: 'CargosSubmission rows in PENDING or PROCESSING',
      registers: [this.registry],
    });
    this.queueSdiInflight = new Gauge({
      name: 'car_rental_integration_queue_sdi_inflight',
      help: 'SdiInvoiceSubmission rows in PENDING or PROCESSING',
      registers: [this.registry],
    });
    this.queueOcrPending = new Gauge({
      name: 'car_rental_integration_queue_customer_document_ocr_pending',
      help:
        'CustomerDocument rows with ocrStatus=PENDING, upload complete, suggestion not applied (G3)',
      registers: [this.registry],
    });
    this.queuePartnerWebhookPending = new Gauge({
      name: 'car_rental_integration_queue_partner_webhook_pending',
      help: 'PartnerWebhookDelivery rows in PENDING or PROCESSING (G2)',
      registers: [this.registry],
    });
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleInit() {
    void this.refreshQueueGauges();
    this.queueInterval = setInterval(() => void this.refreshQueueGauges(), QUEUE_REFRESH_MS);
  }

  onModuleDestroy() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
    }
  }

  recordHttpResponse(method: string | undefined, statusCode: number | undefined) {
    const code = typeof statusCode === 'number' && statusCode > 0 ? statusCode : 0;
    const m = (method ?? 'UNKNOWN').toUpperCase();
    this.httpResponsesTotal.inc({ method: m, status: String(code) });
    if (code >= 500) {
      this.http5xxTotal.inc({ method: m });
    }
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  private async refreshQueueGauges() {
    try {
      const [cargosInflight, sdiInflight, customerDocumentOcrPending, partnerWebhookPending] =
        await Promise.all([
          this.prisma.cargosSubmission.count({
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
          }),
          this.prisma.sdiInvoiceSubmission.count({
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
          }),
          this.prisma.customerDocument.count({
            where: { ocrStatus: 'PENDING', uploadCompletedAt: { not: null }, ocrAppliedAt: null },
          }),
          this.prisma.partnerWebhookDelivery.count({
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
          }),
        ]);
      this.queueCargosInflight.set(cargosInflight);
      this.queueSdiInflight.set(sdiInflight);
      this.queueOcrPending.set(customerDocumentOcrPending);
      this.queuePartnerWebhookPending.set(partnerWebhookPending);
    } catch {
      // Keep last scraped values if DB is briefly unavailable.
    }
  }
}
