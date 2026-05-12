import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  API_VERSION,
  type PatchPartnerApiKeyAllowedIpCidrsInput,
  type PatchPartnerApiKeyWebhookInput,
} from '@car-rental/shared';
import type { PartnerWebhookDeliveryStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class PartnerApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listForCompany(companyId: string) {
    return this.prisma.partnerApiKey.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        webhookUrl: true,
        webhookSigningSecret: true,
        allowedIpCidrs: true,
        oauthClientSecretHash: true,
      },
    }).then((rows) =>
      rows.map(({ webhookSigningSecret, oauthClientSecretHash, ...r }) => ({
        ...r,
        webhookSecretConfigured: Boolean(webhookSigningSecret?.trim()),
        oauthClientConfigured: Boolean(oauthClientSecretHash?.trim()),
      })),
    );
  }

  async create(
    companyId: string,
    name: string,
    createdByUserId: string | null,
  ): Promise<{ id: string; name: string; apiKey: string; createdAt: Date }> {
    const id = randomUUID();
    const secret = randomBytes(16).toString('hex');
    const apiKey = `crtp_${id}_${secret}`;
    const keyHash = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);
    const row = await this.prisma.partnerApiKey.create({
      data: {
        id,
        companyId,
        name: name.trim(),
        keyHash,
        createdByUserId: createdByUserId ?? undefined,
      },
    });
    await this.audit.log({
      userId: createdByUserId,
      action: 'partner_api_key.create',
      entity: 'PartnerApiKey',
      entityId: id,
      metadata: { companyId, name: name.trim() },
    });
    return { id: row.id, name: row.name, apiKey, createdAt: row.createdAt };
  }

  async revoke(companyId: string, keyId: string, userId: string): Promise<void> {
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: keyId, companyId },
    });
    if (!row) {
      throw new NotFoundException('API key not found');
    }
    if (row.revokedAt) {
      return;
    }
    await this.prisma.partnerApiKey.update({
      where: { id: keyId },
      data: {
        revokedAt: new Date(),
        webhookUrl: null,
        webhookSigningSecret: null,
        allowedIpCidrs: null,
        oauthClientSecretHash: null,
      },
    });
    await this.audit.log({
      userId,
      action: 'partner_api_key.revoke',
      entity: 'PartnerApiKey',
      entityId: keyId,
      metadata: { companyId },
    });
  }

  async updateWebhook(
    companyId: string,
    keyId: string,
    body: PatchPartnerApiKeyWebhookInput,
    userId: string,
  ): Promise<{ webhookUrl: string | null; webhookSecretConfigured: boolean }> {
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: keyId, companyId },
    });
    if (!row) {
      throw new NotFoundException('API key not found');
    }
    if (row.revokedAt) {
      throw new BadRequestException('Cannot update webhook settings for a revoked key');
    }

    const data: {
      webhookUrl?: string | null;
      webhookSigningSecret?: string | null;
    } = {};
    if (body.webhookUrl !== undefined) {
      data.webhookUrl = body.webhookUrl === '' ? null : body.webhookUrl;
    }
    if (body.webhookSigningSecret !== undefined) {
      data.webhookSigningSecret =
        body.webhookSigningSecret === '' ? null : body.webhookSigningSecret;
    }

    await this.prisma.partnerApiKey.update({
      where: { id: keyId },
      data,
    });

    await this.audit.log({
      userId,
      action: 'partner_api_key.webhook',
      entity: 'PartnerApiKey',
      entityId: keyId,
      metadata: {
        companyId,
        clearedUrl: body.webhookUrl === '',
        clearedSecret: body.webhookSigningSecret === '',
        setUrl: Boolean(body.webhookUrl && body.webhookUrl !== ''),
        setSecret: Boolean(body.webhookSigningSecret && body.webhookSigningSecret !== ''),
      },
    });

    const cur = await this.prisma.partnerApiKey.findFirst({
      where: { id: keyId, companyId },
      select: { webhookUrl: true, webhookSigningSecret: true },
    });
    return {
      webhookUrl: cur?.webhookUrl ?? null,
      webhookSecretConfigured: Boolean(cur?.webhookSigningSecret?.trim()),
    };
  }

  async updateAllowedIpCidrs(
    companyId: string,
    keyId: string,
    body: PatchPartnerApiKeyAllowedIpCidrsInput,
    userId: string,
  ): Promise<{ id: string; allowedIpCidrs: string | null }> {
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: keyId, companyId },
    });
    if (!row) {
      throw new NotFoundException('API key not found');
    }
    if (row.revokedAt) {
      throw new BadRequestException('Cannot update IP allowlist for a revoked key');
    }
    const next = body.allowedIpCidrs.trim() === '' ? null : body.allowedIpCidrs.trim();
    await this.prisma.partnerApiKey.update({
      where: { id: keyId },
      data: { allowedIpCidrs: next },
    });
    await this.audit.log({
      userId,
      action: 'partner_api_key.allowed_ip',
      entity: 'PartnerApiKey',
      entityId: keyId,
      metadata: { companyId, cleared: next === null, configured: next !== null },
    });
    return { id: keyId, allowedIpCidrs: next };
  }

  /**
   * G2: OAuth2 `client_id` = key UUID; `client_secret` is shown once. POST `/v1/partner/oauth/token` with client_credentials.
   */
  async regenerateOauthClientSecret(
    companyId: string,
    keyId: string,
    userId: string,
  ): Promise<{ clientId: string; clientSecret: string }> {
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: keyId, companyId },
    });
    if (!row) {
      throw new NotFoundException('API key not found');
    }
    if (row.revokedAt) {
      throw new BadRequestException('Cannot configure OAuth for a revoked key');
    }
    const clientSecret = randomBytes(24).toString('base64url');
    const oauthClientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);
    await this.prisma.partnerApiKey.update({
      where: { id: keyId },
      data: { oauthClientSecretHash },
    });
    await this.audit.log({
      userId,
      action: 'partner_api_key.oauth_client',
      entity: 'PartnerApiKey',
      entityId: keyId,
      metadata: { companyId, regenerated: true },
    });
    return { clientId: keyId, clientSecret };
  }

  /** G2: read-only delivery log for all partner keys in the company. */
  async listWebhookDeliveries(
    companyId: string,
    opts: { status?: PartnerWebhookDeliveryStatus; limit: number; offset: number },
  ): Promise<{
    total: number;
    items: Array<{
      id: string;
      partnerApiKeyId: string;
      partnerApiKeyName: string;
      reservationId: string;
      event: string;
      status: PartnerWebhookDeliveryStatus;
      attemptCount: number;
      maxAttempts: number;
      nextAttemptAt: string;
      lastAttemptAt: string | null;
      lastHttpStatus: number | null;
      lastError: string | null;
      succeededAt: string | null;
      createdAt: string;
    }>;
  }> {
    const where: Prisma.PartnerWebhookDeliveryWhereInput = {
      partnerApiKey: { companyId },
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.partnerWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        skip: opts.offset,
        select: {
          id: true,
          partnerApiKeyId: true,
          reservationId: true,
          event: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          nextAttemptAt: true,
          lastAttemptAt: true,
          lastHttpStatus: true,
          lastError: true,
          succeededAt: true,
          createdAt: true,
          partnerApiKey: { select: { name: true } },
        },
      }),
      this.prisma.partnerWebhookDelivery.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        partnerApiKeyId: r.partnerApiKeyId,
        partnerApiKeyName: r.partnerApiKey.name,
        reservationId: r.reservationId,
        event: r.event,
        status: r.status,
        attemptCount: r.attemptCount,
        maxAttempts: r.maxAttempts,
        nextAttemptAt: r.nextAttemptAt.toISOString(),
        lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
        lastHttpStatus: r.lastHttpStatus,
        lastError: r.lastError,
        succeededAt: r.succeededAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * G2: non-secret metadata for the authenticated partner key (credential / integration checks).
   */
  async integrationContextForKey(partnerApiKeyId: string) {
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: partnerApiKeyId, revokedAt: null },
      select: {
        id: true,
        companyId: true,
        name: true,
        createdAt: true,
        webhookUrl: true,
        webhookSigningSecret: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Partner API key not found');
    }
    const url = row.webhookUrl?.trim() ?? '';
    const secret = row.webhookSigningSecret?.trim() ?? '';
    const webhookDeliveryEnabled = Boolean(url && secret && /^https:\/\//i.test(url));
    return {
      partnerApiKeyId: row.id,
      companyId: row.companyId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      webhookDeliveryEnabled,
      apiVersion: API_VERSION,
    };
  }
}
