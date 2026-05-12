import { createReadStream, promises as fsp, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerDocumentPresignBody,
  MAX_CUSTOMER_DOCUMENT_BYTES,
  applyCustomerDocumentOcrBodySchema,
  customerDocumentOcrSuggestionSchema,
  type ApplyCustomerDocumentOcrBody,
  type CustomerDocumentOcrAsyncCompletionBody,
} from '@car-rental/shared';
import type { CustomerDocumentType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/types';
import { assertSameCompany } from '../../auth/company-access';
import { ObjectStorageS3Service } from '../../rental-agreement/object-storage-s3.service';
import { AuditService } from '../../audit/audit.service';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const customerDocumentListSelect = {
  id: true,
  docType: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedByUserId: true,
  retentionUntil: true,
  verifiedAt: true,
  verifiedByUserId: true,
  ocrStatus: true,
  ocrSuggestionJson: true,
  ocrCompletedAt: true,
  ocrVendor: true,
  ocrError: true,
  ocrAppliedAt: true,
  ocrAppliedByUserId: true,
} as const;

@Injectable()
export class CustomerDocumentService implements OnModuleInit {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly s3: ObjectStorageS3Service,
    private readonly audit: AuditService,
  ) {
    this.root = this.config.get<string>('STORAGE_LOCAL_ROOT', join(process.cwd(), 'data', 'uploads'));
  }

  onModuleInit() {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  private isS3Mode(): boolean {
    return this.s3.isS3Mode();
  }

  getStorageConfig(): { mode: 'local' | 's3' } {
    return { mode: this.isS3Mode() ? 's3' : 'local' };
  }

  private absPath(relativeKey: string): string {
    return join(this.root, ...relativeKey.split('/'));
  }

  private async ensureDir(companyId: string, customerId: string) {
    const p = join(this.root, companyId, 'customers', customerId);
    await fsp.mkdir(p, { recursive: true });
  }

  private safeOriginalName(n: string): string {
    const b = n.replace(/[/\\]/g, '_').split('\0').join('').trim().slice(0, 200);
    return b || 'file';
  }

  private extFromNameOrMime(originalName: string, mime: string): string {
    const m = originalName.match(/\.(pdf|jpe?g|png|webp)$/i);
    if (m) {
      return m[0].toLowerCase();
    }
    if (mime === 'application/pdf') return '.pdf';
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    return '.bin';
  }

  private async getCustomerForAccess(customerId: string, user: JwtUser) {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    assertSameCompany(user, c.companyId, `Customer not found: ${customerId}`);
    return c;
  }

  private completedDocumentsWhere(): Prisma.CustomerDocumentWhereInput {
    return {
      OR: [{ storage: 'LOCAL' as const }, { uploadCompletedAt: { not: null } }],
    };
  }

  async list(customerId: string, user: JwtUser) {
    await this.getCustomerForAccess(customerId, user);
    return this.prisma.customerDocument.findMany({
      where: {
        customerId,
        ...this.completedDocumentsWhere(),
      },
      orderBy: { createdAt: 'asc' },
      select: customerDocumentListSelect,
    });
  }

  async upload(
    customerId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    docType: CustomerDocumentType,
    retentionUntil: Date | null | undefined,
    user: JwtUser,
  ) {
    if (this.isS3Mode()) {
      throw new BadRequestException(
        'Multipart upload to API is disabled when STORAGE_MODE=s3; use presigned upload from the client',
      );
    }
    if (!file?.buffer || file.size < 1) {
      throw new BadRequestException('File is empty');
    }
    if (file.size > MAX_CUSTOMER_DOCUMENT_BYTES) {
      throw new BadRequestException('File size exceeds 10MB');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Only PDF and JPEG, PNG, WebP images are allowed');
    }
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const c = await this.getCustomerForAccess(customerId, user);
    const originalName = this.safeOriginalName(file.originalname);
    const id = randomUUID();
    const ext = this.extFromNameOrMime(originalName, file.mimetype);
    const storageKey = `${c.companyId}/customers/${customerId}/${id}${ext}`;
    await this.ensureDir(c.companyId, customerId);
    const dest = this.absPath(storageKey);
    const completedAt = new Date();
    await fsp.writeFile(dest, file.buffer);
    try {
      const created = await this.prisma.customerDocument.create({
        data: {
          id,
          companyId: c.companyId,
          customerId,
          docType,
          originalName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          storage: 'LOCAL',
          uploadCompletedAt: completedAt,
          uploadedByUserId: user.sub,
          retentionUntil: retentionUntil ?? null,
        },
        select: { id: true },
      });
      await this.maybeQueuePendingOcr(created.id);
      return await this.prisma.customerDocument.findUniqueOrThrow({
        where: { id: created.id },
        select: customerDocumentListSelect,
      });
    } catch (e) {
      await fsp.rm(dest, { force: true });
      throw e;
    }
  }

  async createPresignedUpload(customerId: string, body: CustomerDocumentPresignBody, user: JwtUser) {
    if (!this.isS3Mode()) {
      throw new BadRequestException('Presigned upload is only available when STORAGE_MODE=s3');
    }
    if (!ALLOWED_MIME.has(body.mimeType)) {
      throw new BadRequestException('Only PDF and JPEG, PNG, WebP images are allowed');
    }
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const c = await this.getCustomerForAccess(customerId, user);
    const originalName = this.safeOriginalName(body.originalName);
    const id = randomUUID();
    const ext = this.extFromNameOrMime(originalName, body.mimeType);
    const storageKey = `${c.companyId}/customers/${customerId}/${id}${ext}`;
    const row = await this.prisma.customerDocument.create({
      data: {
        id,
        companyId: c.companyId,
        customerId,
        docType: body.docType,
        originalName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        storageKey,
        storage: 'S3',
        uploadCompletedAt: null,
        uploadedByUserId: user.sub,
        retentionUntil: body.retentionUntil ?? null,
      },
      select: customerDocumentListSelect,
    });
    const uploadUrl = await this.s3.getPresignedPutUrl(storageKey, body.mimeType);
    return {
      document: row,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': body.mimeType },
    };
  }

  async completePresignedUpload(customerId: string, documentId: string, user: JwtUser) {
    if (!this.isS3Mode()) {
      throw new BadRequestException('Not in S3 mode');
    }
    await this.getCustomerForAccess(customerId, user);
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (att.storage !== 'S3') {
      throw new BadRequestException('Not a presigned S3 document');
    }
    if (att.uploadCompletedAt) {
      return this.prisma.customerDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: customerDocumentListSelect,
      });
    }
    let head;
    try {
      head = await this.s3.headObject(att.storageKey);
    } catch {
      throw new NotFoundException('Object not found in storage; upload may have failed or expired');
    }
    const len = head.ContentLength ?? 0;
    if (len < 1 || len > MAX_CUSTOMER_DOCUMENT_BYTES) {
      await this.s3.deleteObject(att.storageKey);
      await this.prisma.customerDocument.delete({ where: { id: att.id } });
      throw new BadRequestException('Uploaded file size is invalid');
    }
    await this.prisma.customerDocument.update({
      where: { id: att.id },
      data: {
        sizeBytes: len,
        uploadCompletedAt: new Date(),
      },
      select: { id: true },
    });
    await this.maybeQueuePendingOcr(att.id);
    return this.prisma.customerDocument.findUniqueOrThrow({
      where: { id: att.id },
      select: customerDocumentListSelect,
    });
  }

  async getFileForDownload(
    customerId: string,
    documentId: string,
    user: JwtUser,
    ctx: { ip?: string; userAgent?: string | undefined } = {},
  ) {
    await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (att.storage === 'S3' && !att.uploadCompletedAt) {
      throw new NotFoundException('Upload not completed yet');
    }
    await this.audit.log({
      userId: user.sub,
      action: 'customer_document.download',
      entity: 'CustomerDocument',
      entityId: att.id,
      metadata: { customerId, companyId: att.companyId, originalName: att.originalName },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    if (att.storage === 'S3') {
      const stream = await this.s3.getObjectStream(att.storageKey);
      return { attachment: att, createReadStream: () => stream };
    }
    const abs = this.absPath(att.storageKey);
    try {
      await fsp.access(abs);
    } catch {
      throw new NotFoundException('File missing on disk');
    }
    return { attachment: att, createReadStream: () => createReadStream(abs) };
  }

  async remove(customerId: string, documentId: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (att.storage === 'S3') {
      await this.s3.deleteObject(att.storageKey);
    } else {
      const abs = this.absPath(att.storageKey);
      try {
        await fsp.rm(abs, { force: true });
      } catch {
        // ignore
      }
    }
    await this.prisma.customerDocument.delete({ where: { id: documentId } });
    return { ok: true as const };
  }

  async setVerification(customerId: string, documentId: string, verified: boolean, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (!att.uploadCompletedAt) {
      throw new BadRequestException(
        'Document upload is not complete; finish upload before verification',
      );
    }
    const updated = await this.prisma.customerDocument.update({
      where: { id: documentId },
      data: verified
        ? { verifiedAt: new Date(), verifiedByUserId: user.sub }
        : { verifiedAt: null, verifiedByUserId: null },
      select: customerDocumentListSelect,
    });
    await this.audit.log({
      userId: user.sub,
      action: verified ? 'customer_document.verify' : 'customer_document.unverify',
      entity: 'CustomerDocument',
      entityId: documentId,
      metadata: { customerId, companyId: att.companyId, originalName: att.originalName },
    });
    return updated;
  }

  private mockOcrSuggestion(att: {
    id: string;
    docType: CustomerDocumentType;
    originalName: string;
  }, customer: { name: string; fiscalCode: string | null }): Record<string, unknown> {
    const expiry = new Date();
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 5);
    const expiryDate = expiry.toISOString().slice(0, 10);
    const base: Record<string, unknown> = {
      documentNumber: `MOCK-${att.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      expiryDate,
      note:
        'Mock OCR (G3) — not a real extraction; staff must verify and apply fields deliberately.',
    };
    if (att.docType !== 'OTHER') {
      const parts = customer.name.trim().split(/\s+/).filter(Boolean);
      const rotated =
        parts.length > 1
          ? [...parts.slice(1), parts[0]].join(' ')
          : `${customer.name.trim()} [demo]`;
      base['fullName'] = rotated;
    }
    if (!customer.fiscalCode?.trim()) {
      base['fiscalCode'] = 'RSSMRA80A01H501U';
    }
    return customerDocumentOcrSuggestionSchema.parse(base);
  }

  private ocrAutoMockEnabled(): boolean {
    const v = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_AUTO')?.trim().toLowerCase() ?? '';
    return v === 'mock';
  }

  private ocrAutoHttpEnabled(): boolean {
    const v = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_AUTO')?.trim().toLowerCase() ?? '';
    return v === 'http';
  }

  private shouldQueueOcrAfterUpload(): boolean {
    return this.ocrAutoMockEnabled() || this.ocrAutoHttpEnabled();
  }

  private getOcrHttpBaseUrl(): string | null {
    const url = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_URL')?.trim() ?? '';
    return url || null;
  }

  private getOcrHttpVendorLabel(): string {
    const v = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_VENDOR')?.trim() ?? '';
    return (v || 'HTTP').slice(0, 64);
  }

  private getOcrHttpTimeoutMs(): number {
    const raw = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_TIMEOUT_MS');
    const n = raw == null || raw === '' ? 30_000 : Number.parseInt(String(raw), 10);
    const v = Number.isFinite(n) ? n : 30_000;
    return Math.min(120_000, Math.max(5_000, v));
  }

  /** G3: include `documentDownloadUrl` on OCR POST when `STORAGE_MODE=s3` and this is truthy. */
  private getOcrIncludePresignedGet(): boolean {
    const v =
      this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_INCLUDE_PRESIGNED_GET')?.trim().toLowerCase() ?? '';
    return v === '1' || v === 'true' || v === 'yes';
  }

  private getOcrPresignGetSeconds(): number {
    const raw = this.config.get<string | number>('CUSTOMER_DOCUMENT_OCR_HTTP_PRESIGN_GET_SECONDS');
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    const v = Number.isFinite(n) ? n : 300;
    return Math.min(3600, Math.max(60, v));
  }

  /**
   * When `CUSTOMER_DOCUMENT_OCR_AUTO` is `mock` or `http`, mark the doc for the internal OCR cron after upload completes.
   */
  private async maybeQueuePendingOcr(documentId: string): Promise<void> {
    if (!this.shouldQueueOcrAfterUpload()) return;
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att?.uploadCompletedAt || att.ocrAppliedAt) return;
    await this.prisma.customerDocument.update({
      where: { id: documentId },
      data: {
        ocrStatus: 'PENDING',
        ocrSuggestionJson: Prisma.JsonNull,
        ocrCompletedAt: null,
        ocrVendor: null,
        ocrError: null,
      },
    });
  }

  private async callHttpOcrAdapter(
    att: {
      id: string;
      docType: CustomerDocumentType;
      originalName: string;
      mimeType: string;
      customerId: string;
      companyId: string;
      storageKey: string;
      storage: 'LOCAL' | 'S3';
    },
    customer: { name: string; fiscalCode: string | null },
  ): Promise<unknown> {
    const baseUrl = this.getOcrHttpBaseUrl();
    if (!baseUrl) {
      throw new Error('CUSTOMER_DOCUMENT_OCR_HTTP_URL is not configured');
    }
    const bearerSecret = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_SECRET')?.trim() ?? '';
    const timeoutMs = this.getOcrHttpTimeoutMs();

    let documentDownloadUrl: string | undefined;
    if (this.getOcrIncludePresignedGet() && att.storage === 'S3' && this.s3.isS3Mode()) {
      try {
        documentDownloadUrl = await this.s3.getPresignedGetUrl(
          att.storageKey,
          this.getOcrPresignGetSeconds(),
        );
      } catch {
        /* adapter may use metadata-only contract */
      }
    }

    const payload: Record<string, unknown> = {
      documentId: att.id,
      companyId: att.companyId,
      customerId: att.customerId,
      docType: att.docType,
      originalName: att.originalName,
      mimeType: att.mimeType,
      customer: {
        name: customer.name,
        fiscalCode: customer.fiscalCode?.trim() ? customer.fiscalCode : null,
      },
    };
    if (documentDownloadUrl) {
      payload.documentDownloadUrl = documentDownloadUrl;
    }

    const bodyStr = JSON.stringify(payload);
    const hmacSecret = this.config.get<string>('CUSTOMER_DOCUMENT_OCR_HTTP_HMAC_SECRET')?.trim() ?? '';

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bearerSecret) {
        headers['Authorization'] = `Bearer ${bearerSecret}`;
      }
      if (hmacSecret) {
        const ts = Math.floor(Date.now() / 1000).toString();
        const sig = createHmac('sha256', hmacSecret).update(`${ts}.${bodyStr}`, 'utf8').digest('hex');
        headers['X-CarRental-Ocr-Timestamp'] = ts;
        headers['X-CarRental-Ocr-Signature'] = sig;
      }
      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: ac.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`OCR HTTP ${resp.status}: ${text.slice(0, 500)}`);
      }
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new Error('OCR HTTP response is not JSON');
      }
      const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
      const raw = root['suggestion'] ?? root;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('OCR HTTP response missing suggestion object');
      }
      return customerDocumentOcrSuggestionSchema.parse(raw);
    } finally {
      clearTimeout(timer);
    }
  }

  private async persistVendorOcrResult(
    att: {
      id: string;
      docType: CustomerDocumentType;
      originalName: string;
      customerId: string;
      companyId: string;
    },
    suggestionRaw: unknown,
    vendor: string,
    actorUserId: string | null,
    auditAction:
      | 'customer_document.ocr_mock_run'
      | 'customer_document.ocr_cron_mock'
      | 'customer_document.ocr_cron_http'
      | 'customer_document.ocr_async_callback',
    auditExtra?: Record<string, unknown>,
  ) {
    const validated = customerDocumentOcrSuggestionSchema.parse(suggestionRaw);
    const updated = await this.prisma.customerDocument.update({
      where: { id: att.id },
      data: {
        ocrStatus: 'READY',
        ocrSuggestionJson: validated as object,
        ocrCompletedAt: new Date(),
        ocrVendor: vendor,
        ocrError: null,
      },
      select: customerDocumentListSelect,
    });
    await this.audit.log({
      userId: actorUserId,
      action: auditAction,
      entity: 'CustomerDocument',
      entityId: att.id,
      metadata: {
        customerId: att.customerId,
        companyId: att.companyId,
        docType: att.docType,
        ...(auditExtra ?? {}),
      },
    });
    return updated;
  }

  private async persistMockOcrResult(
    att: {
      id: string;
      docType: CustomerDocumentType;
      originalName: string;
      customerId: string;
      companyId: string;
    },
    customer: { name: string; fiscalCode: string | null },
    actorUserId: string | null,
  ) {
    const suggestion = this.mockOcrSuggestion(att, customer);
    return this.persistVendorOcrResult(
      att,
      suggestion,
      'MOCK',
      actorUserId,
      actorUserId ? 'customer_document.ocr_mock_run' : 'customer_document.ocr_cron_mock',
    );
  }

  /**
   * G3: worker batch — same mock suggestion as `runMockOcr`, without a JWT user (audit uses null userId).
   */
  async processPendingOcrMockBatch(limit: number): Promise<{ processed: number; failed: number }> {
    const rows = await this.prisma.customerDocument.findMany({
      where: {
        ocrStatus: 'PENDING',
        uploadCompletedAt: { not: null },
        ocrAppliedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        docType: true,
        originalName: true,
        customerId: true,
        companyId: true,
      },
    });
    let processed = 0;
    let failed = 0;
    for (const att of rows) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: att.customerId },
        select: { name: true, fiscalCode: true },
      });
      if (!customer) {
        failed++;
        await this.prisma.customerDocument.update({
          where: { id: att.id },
          data: {
            ocrStatus: 'FAILED',
            ocrError: 'Customer missing for document',
            ocrVendor: null,
            ocrCompletedAt: null,
            ocrSuggestionJson: Prisma.JsonNull,
          },
        });
        continue;
      }
      try {
        await this.persistMockOcrResult(
          att,
          { name: customer.name, fiscalCode: customer.fiscalCode ?? null },
          null,
        );
        processed++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await this.prisma.customerDocument.update({
          where: { id: att.id },
          data: {
            ocrStatus: 'FAILED',
            ocrError: msg.slice(0, 2000),
            ocrVendor: null,
            ocrCompletedAt: null,
            ocrSuggestionJson: Prisma.JsonNull,
          },
        });
      }
    }
    return { processed, failed };
  }

  /**
   * G3: worker batch — POST JSON to `CUSTOMER_DOCUMENT_OCR_HTTP_URL`; response must match `customerDocumentOcrSuggestionSchema`
   * (full body or `{ "suggestion": { ... } }`).
   */
  async processPendingOcrHttpBatch(limit: number): Promise<{ processed: number; failed: number }> {
    const vendor = this.getOcrHttpVendorLabel();
    const rows = await this.prisma.customerDocument.findMany({
      where: {
        ocrStatus: 'PENDING',
        uploadCompletedAt: { not: null },
        ocrAppliedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        docType: true,
        originalName: true,
        mimeType: true,
        customerId: true,
        companyId: true,
        storageKey: true,
        storage: true,
      },
    });
    let processed = 0;
    let failed = 0;
    for (const att of rows) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: att.customerId },
        select: { name: true, fiscalCode: true },
      });
      if (!customer) {
        failed++;
        await this.prisma.customerDocument.update({
          where: { id: att.id },
          data: {
            ocrStatus: 'FAILED',
            ocrError: 'Customer missing for document',
            ocrVendor: null,
            ocrCompletedAt: null,
            ocrSuggestionJson: Prisma.JsonNull,
          },
        });
        continue;
      }
      try {
        const suggestion = await this.callHttpOcrAdapter(att, {
          name: customer.name,
          fiscalCode: customer.fiscalCode ?? null,
        });
        await this.persistVendorOcrResult(
          att,
          suggestion,
          vendor,
          null,
          'customer_document.ocr_cron_http',
        );
        processed++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        await this.prisma.customerDocument.update({
          where: { id: att.id },
          data: {
            ocrStatus: 'FAILED',
            ocrError: msg.slice(0, 2000),
            ocrVendor: null,
            ocrCompletedAt: null,
            ocrSuggestionJson: Prisma.JsonNull,
          },
        });
      }
    }
    return { processed, failed };
  }

  async runMockOcr(customerId: string, documentId: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const c = await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (!att.uploadCompletedAt) {
      throw new BadRequestException(
        'Document upload is not complete; finish upload before running OCR',
      );
    }
    if (att.ocrAppliedAt) {
      throw new BadRequestException('OCR was already applied for this document');
    }
    return this.persistMockOcrResult(
      {
        id: att.id,
        docType: att.docType,
        originalName: att.originalName,
        customerId: att.customerId,
        companyId: att.companyId,
      },
      { name: c.name, fiscalCode: c.fiscalCode ?? null },
      user.sub,
    );
  }

  async dismissOcrSuggestion(customerId: string, documentId: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (att.ocrAppliedAt) {
      throw new BadRequestException('Cannot dismiss OCR after it was applied');
    }
    const updated = await this.prisma.customerDocument.update({
      where: { id: documentId },
      data: {
        ocrStatus: 'NONE',
        ocrSuggestionJson: Prisma.JsonNull,
        ocrCompletedAt: null,
        ocrVendor: null,
        ocrError: null,
      },
      select: customerDocumentListSelect,
    });
    await this.audit.log({
      userId: user.sub,
      action: 'customer_document.ocr_dismiss',
      entity: 'CustomerDocument',
      entityId: documentId,
      metadata: { customerId, companyId: att.companyId },
    });
    return updated;
  }

  async applyOcrSuggestion(
    customerId: string,
    documentId: string,
    body: ApplyCustomerDocumentOcrBody,
    user: JwtUser,
  ) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const parsed = applyCustomerDocumentOcrBodySchema.parse(body);
    const c = await this.getCustomerForAccess(customerId, user);
    const att = await this.prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!att || att.customerId !== customerId) {
      throw new NotFoundException('Document not found');
    }
    if (att.ocrStatus !== 'READY' || att.ocrSuggestionJson == null) {
      throw new BadRequestException('No OCR suggestion to apply');
    }
    if (att.ocrAppliedAt) {
      throw new BadRequestException('OCR suggestion was already applied');
    }
    const raw =
      typeof att.ocrSuggestionJson === 'object' && att.ocrSuggestionJson !== null
        ? att.ocrSuggestionJson
        : {};
    const suggestion = customerDocumentOcrSuggestionSchema.parse(raw);

    const updates: { name?: string; fiscalCode?: string; notes?: string } = {};
    if (parsed.applyName) {
      if (!suggestion.fullName?.trim()) {
        throw new BadRequestException('Suggested full name is missing');
      }
      updates.name = suggestion.fullName.trim();
    }
    if (parsed.applyFiscalCode) {
      if (!suggestion.fiscalCode?.trim()) {
        throw new BadRequestException('Suggested fiscal code is missing');
      }
      updates.fiscalCode = suggestion.fiscalCode.trim().toUpperCase();
    }
    let notesAppend = '';
    if (parsed.appendDetailsToNotes) {
      const bits: string[] = [];
      if (suggestion.documentNumber) {
        bits.push(`doc# ${suggestion.documentNumber}`);
      }
      if (suggestion.expiryDate) {
        bits.push(`exp ${suggestion.expiryDate}`);
      }
      if (!bits.length) {
        throw new BadRequestException('No document number or expiry in suggestion to append');
      }
      notesAppend = `[OCR ${new Date().toISOString().slice(0, 10)}] ${bits.join('; ')}`;
    }

    if (Object.keys(updates).length === 0 && !notesAppend) {
      throw new BadRequestException('Nothing to apply');
    }

    await this.prisma.$transaction(async (tx) => {
      const noteParts: string[] = [];
      if (notesAppend) {
        const cur = c.notes?.trim();
        noteParts.push(cur ? `${cur}\n${notesAppend}` : notesAppend);
      }
      const customerPatch = {
        ...updates,
        ...(noteParts.length ? { notes: noteParts[0] } : {}),
      };
      if (Object.keys(customerPatch).length > 0) {
        await tx.customer.update({
          where: { id: customerId },
          data: customerPatch,
        });
      }
      await tx.customerDocument.update({
        where: { id: documentId },
        data: {
          ocrAppliedAt: new Date(),
          ocrAppliedByUserId: user.sub,
        },
      });
    });

    const updated = await this.prisma.customerDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: customerDocumentListSelect,
    });
    await this.audit.log({
      userId: user.sub,
      action: 'customer_document.ocr_apply',
      entity: 'CustomerDocument',
      entityId: documentId,
      metadata: {
        customerId,
        companyId: att.companyId,
        applied: {
          applyName: Boolean(parsed.applyName),
          applyFiscalCode: Boolean(parsed.applyFiscalCode),
          appendDetailsToNotes: Boolean(parsed.appendDetailsToNotes),
        },
      },
    });
    return updated;
  }

  /**
   * G3: apply OCR result from an async adapter (Bearer `WORKER_INTERNAL_SECRET` on `POST …/internal/cron/customer-document-ocr-callback`).
   * Document must be **`PENDING`**, upload complete, not yet staff-applied.
   */
  async completeOcrFromAsyncWorker(body: CustomerDocumentOcrAsyncCompletionBody): Promise<{
    documentId: string;
    outcome: 'READY' | 'FAILED';
  }> {
    const att = await this.prisma.customerDocument.findUnique({
      where: { id: body.documentId },
      select: {
        id: true,
        docType: true,
        originalName: true,
        customerId: true,
        companyId: true,
        uploadCompletedAt: true,
        ocrAppliedAt: true,
        ocrStatus: true,
      },
    });
    if (!att) {
      throw new NotFoundException('Document not found');
    }
    if (!att.uploadCompletedAt) {
      throw new BadRequestException('Document upload is not complete');
    }
    if (att.ocrAppliedAt) {
      throw new BadRequestException('OCR was already applied for this document');
    }
    if (att.ocrStatus !== 'PENDING') {
      throw new ConflictException(
        `Document OCR status is ${att.ocrStatus}; async callback only accepts PENDING`,
      );
    }
    const errMsg = body.error?.trim() ?? '';
    if (errMsg.length > 0) {
      await this.prisma.customerDocument.update({
        where: { id: att.id },
        data: {
          ocrStatus: 'FAILED',
          ocrError: errMsg.slice(0, 2000),
          ocrVendor: body.vendor?.trim() || null,
          ocrCompletedAt: new Date(),
          ocrSuggestionJson: Prisma.JsonNull,
        },
      });
      await this.audit.log({
        userId: null,
        action: 'customer_document.ocr_async_callback',
        entity: 'CustomerDocument',
        entityId: att.id,
        metadata: {
          customerId: att.customerId,
          companyId: att.companyId,
          docType: att.docType,
          outcome: 'FAILED',
        },
      });
      return { documentId: att.id, outcome: 'FAILED' };
    }
    const vendor = body.vendor?.trim() || 'ASYNC_CALLBACK';
    await this.persistVendorOcrResult(
      {
        id: att.id,
        docType: att.docType,
        originalName: att.originalName,
        customerId: att.customerId,
        companyId: att.companyId,
      },
      body.suggestion!,
      vendor,
      null,
      'customer_document.ocr_async_callback',
      { outcome: 'READY' },
    );
    return { documentId: att.id, outcome: 'READY' };
  }
}
