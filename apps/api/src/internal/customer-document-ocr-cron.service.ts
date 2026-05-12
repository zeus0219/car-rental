import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerDocumentService } from '../organization/customer/customer-document.service';

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

/**
 * G3: process `CustomerDocument` rows queued for OCR (`ocrStatus=PENDING` when
 * `CUSTOMER_DOCUMENT_OCR_AUTO` is `mock` or `http`). Triggered by `POST /v1/internal/cron/customer-document-ocr`.
 */
@Injectable()
export class CustomerDocumentOcrCronService {
  private readonly log = new Logger(CustomerDocumentOcrCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly customerDocuments: CustomerDocumentService,
  ) {}

  async processDueBatch(): Promise<{
    processed: number;
    failed: number;
    batchLimit: number;
    skipped?: boolean;
    reason?: string;
  }> {
    const batchLimit = Math.min(
      100,
      Math.max(1, parseIntEnv(this.config.get<string>('CUSTOMER_DOCUMENT_OCR_CRON_BATCH'), 20, 1, 100)),
    );
    const mode = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_AUTO')?.trim().toLowerCase() ?? '';
    if (mode !== 'mock' && mode !== 'http') {
      return {
        processed: 0,
        failed: 0,
        batchLimit,
        skipped: true,
        reason: 'CUSTOMER_DOCUMENT_OCR_AUTO is not mock or http',
      };
    }
    if (mode === 'http') {
      const url = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_URL')?.trim() ?? '';
      if (!url) {
        return {
          processed: 0,
          failed: 0,
          batchLimit,
          skipped: true,
          reason: 'CUSTOMER_DOCUMENT_OCR_HTTP_URL is required when CUSTOMER_DOCUMENT_OCR_AUTO=http',
        };
      }
    }
    const r =
      mode === 'mock'
        ? await this.customerDocuments.processPendingOcrMockBatch(batchLimit)
        : await this.customerDocuments.processPendingOcrHttpBatch(batchLimit);
    if (r.processed > 0 || r.failed > 0) {
      this.log.log(`customer-document OCR batch: processed=${r.processed} failed=${r.failed}`);
    }
    return { ...r, batchLimit };
  }
}
