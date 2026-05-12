import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const WEBHOOK_TIMEOUT_MS = 12_000;

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

/** Exponential backoff after a failed attempt (`attemptCount` after increment). */
function backoffMsAfterAttempt(attemptAfterFailure: number): number {
  const base = 30_000;
  const exp = Math.min(6, Math.max(0, attemptAfterFailure - 1));
  return Math.min(900_000, base * 2 ** exp);
}

@Injectable()
export class PartnerWebhookService {
  private readonly log = new Logger(PartnerWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * G2: enqueue `reservation.created` for HTTPS POST + HMAC (worker/cron delivers).
   * Skips when the key has no webhook URL/secret or URL is not HTTPS.
   */
  async enqueueReservationCreated(partnerApiKeyId: string, reservationId: string): Promise<void> {
    await this.enqueueReservationWebhookEvent(partnerApiKeyId, reservationId, 'reservation.created');
  }

  /** G2: same delivery pipeline as **`reservation.created`**; body includes **`previousStatus`**. */
  async enqueueReservationCancelled(
    partnerApiKeyId: string,
    reservationId: string,
    previousStatus: string,
  ): Promise<void> {
    await this.enqueueReservationWebhookEvent(partnerApiKeyId, reservationId, 'reservation.cancelled', {
      previousStatus,
    });
  }

  /**
   * G2: staff **`PATCH /reservations`** or Stripe rental checkout completion changed **`status`** on a **PARTNER** booking.
   * Same HMAC pipeline; **`X-Partner-Event: reservation.status_changed`**.
   */
  async enqueueReservationStatusChanged(
    partnerApiKeyId: string,
    reservationId: string,
    previousStatus: string,
  ): Promise<void> {
    await this.enqueueReservationWebhookEvent(
      partnerApiKeyId,
      reservationId,
      'reservation.status_changed',
      { previousStatus },
    );
  }

  private async enqueueReservationWebhookEvent(
    partnerApiKeyId: string,
    reservationId: string,
    event: 'reservation.created' | 'reservation.cancelled' | 'reservation.status_changed',
    extra?: { previousStatus?: string },
  ): Promise<void> {
    try {
      const bodyJson = await this.buildReservationWebhookBodyJson(
        partnerApiKeyId,
        reservationId,
        event,
        extra,
      );
      if (!bodyJson) {
        return;
      }
      const maxAttempts = Math.min(
        50,
        Math.max(1, parseIntEnv(this.config.get<string>('PARTNER_WEBHOOK_MAX_ATTEMPTS'), 8, 1, 50)),
      );
      await this.prisma.partnerWebhookDelivery.create({
        data: {
          partnerApiKeyId,
          reservationId,
          event,
          bodyJson,
          maxAttempts,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        },
      });
    } catch (e) {
      this.log.warn(
        `enqueue ${event}: ${e instanceof Error ? e.message : String(e)} (key ${partnerApiKeyId} res ${reservationId})`,
      );
    }
  }

  /** G2: `POST /v1/internal/cron/partner-webhook-deliveries` — bounded batch with backoff retries. */
  async processDueDeliveriesBatch(): Promise<{
    processed: number;
    succeeded: number;
    retried: number;
    dead: number;
    batchLimit: number;
  }> {
    const batchLimit = Math.min(
      100,
      Math.max(1, parseIntEnv(this.config.get<string>('PARTNER_WEBHOOK_CRON_BATCH'), 20, 1, 100)),
    );
    const staleMs = Math.min(
      3_600_000,
      Math.max(
        60_000,
        parseIntEnv(this.config.get<string>('PARTNER_WEBHOOK_STALE_MS'), 900_000, 60_000, 3_600_000),
      ),
    );
    const deadline = new Date(Date.now() - staleMs);
    await this.prisma.partnerWebhookDelivery.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: deadline } },
      data: { status: 'PENDING' },
    });

    let processed = 0;
    let succeeded = 0;
    let retried = 0;
    let dead = 0;

    for (let i = 0; i < batchLimit; i += 1) {
      const now = new Date();
      const due = await this.prisma.partnerWebhookDelivery.findFirst({
        where: {
          status: 'PENDING',
          nextAttemptAt: { lte: now },
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!due) {
        break;
      }
      const lock = await this.prisma.partnerWebhookDelivery.updateMany({
        where: { id: due.id, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      if (lock.count === 0) {
        continue;
      }

      processed += 1;
      const r = await this.deliverOne(due.id);
      if (r === 'succeeded') {
        succeeded += 1;
      } else if (r === 'retried') {
        retried += 1;
      } else if (r === 'dead') {
        dead += 1;
      }
    }

    if (processed > 0) {
      this.log.log(
        `partner webhook batch: processed=${processed} ok=${succeeded} retried=${retried} dead=${dead}`,
      );
    }

    return { processed, succeeded, retried, dead, batchLimit };
  }

  private async deliverOne(id: string): Promise<'succeeded' | 'retried' | 'dead' | 'skipped'> {
    const row = await this.prisma.partnerWebhookDelivery.findFirst({
      where: { id },
      include: {
        partnerApiKey: {
          select: { webhookUrl: true, webhookSigningSecret: true, revokedAt: true },
        },
      },
    });
    if (!row) {
      return 'skipped';
    }

    const url = row.partnerApiKey.webhookUrl?.trim() ?? '';
    const secret = row.partnerApiKey.webhookSigningSecret?.trim() ?? '';
    const revoked = row.partnerApiKey.revokedAt != null;

    if (revoked || !url || !secret || !/^https:\/\//i.test(url)) {
      await this.prisma.partnerWebhookDelivery.update({
        where: { id },
        data: {
          status: 'DEAD',
          lastAttemptAt: new Date(),
          lastHttpStatus: null,
          lastError: revoked
            ? 'Partner API key revoked'
            : !url || !secret
              ? 'Webhook URL or signing secret not configured'
              : 'Webhook URL must be HTTPS',
        },
      });
      return 'dead';
    }

    const sig = createHmac('sha256', secret).update(row.bodyJson, 'utf8').digest('hex');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);
    let httpStatus: number | null = null;
    let errMsg: string | null = null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Partner-Event': row.event,
          'X-Partner-Signature': `sha256=${sig}`,
        },
        body: row.bodyJson,
        signal: ac.signal,
      });
      httpStatus = res.status;
      if (res.ok) {
        await this.prisma.partnerWebhookDelivery.update({
          where: { id },
          data: {
            status: 'SUCCEEDED',
            succeededAt: new Date(),
            lastAttemptAt: new Date(),
            lastHttpStatus: httpStatus,
            lastError: null,
          },
        });
        return 'succeeded';
      }
      const t = await res.text().catch(() => '');
      errMsg = `HTTP ${res.status} ${t.slice(0, 500)}`;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }

    const nextCount = row.attemptCount + 1;
    if (nextCount >= row.maxAttempts) {
      await this.prisma.partnerWebhookDelivery.update({
        where: { id },
        data: {
          status: 'DEAD',
          attemptCount: nextCount,
          lastAttemptAt: new Date(),
          lastHttpStatus: httpStatus,
          lastError: (errMsg ?? 'delivery failed').slice(0, 2000),
        },
      });
      this.log.warn(`partner webhook DEAD id=${id} attempts=${nextCount} err=${(errMsg ?? '').slice(0, 200)}`);
      return 'dead';
    }

    const nextAt = new Date(Date.now() + backoffMsAfterAttempt(nextCount));
    await this.prisma.partnerWebhookDelivery.update({
      where: { id },
      data: {
        status: 'PENDING',
        attemptCount: nextCount,
        nextAttemptAt: nextAt,
        lastAttemptAt: new Date(),
        lastHttpStatus: httpStatus,
        lastError: errMsg?.slice(0, 2000) ?? null,
      },
    });
    return 'retried';
  }

  private async buildReservationWebhookBodyJson(
    partnerApiKeyId: string,
    reservationId: string,
    event: 'reservation.created' | 'reservation.cancelled' | 'reservation.status_changed',
    extra?: { previousStatus?: string },
  ): Promise<string | null> {
    const key = await this.prisma.partnerApiKey.findFirst({
      where: { id: partnerApiKeyId, revokedAt: null },
      select: { webhookUrl: true, webhookSigningSecret: true },
    });
    const url = key?.webhookUrl?.trim();
    const secret = key?.webhookSigningSecret?.trim();
    if (!url || !secret) {
      return null;
    }
    if (!/^https:\/\//i.test(url)) {
      this.log.warn(`${event} webhook skipped: URL must be HTTPS (key ${partnerApiKeyId})`);
      return null;
    }

    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId },
      select: {
        id: true,
        companyId: true,
        status: true,
        pickupAt: true,
        returnAt: true,
      },
    });
    if (!reservation) {
      return null;
    }

    const occurredAt = new Date().toISOString();
    const payload = {
      event,
      occurredAt,
      reservation: {
        id: reservation.id,
        companyId: reservation.companyId,
        status: reservation.status,
        pickupAt: reservation.pickupAt.toISOString(),
        returnAt: reservation.returnAt.toISOString(),
      },
      ...(extra?.previousStatus != null && extra.previousStatus !== ''
        ? { previousStatus: extra.previousStatus }
        : {}),
    };
    return JSON.stringify(payload);
  }
}
