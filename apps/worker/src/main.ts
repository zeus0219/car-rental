/**
 * Picks PENDING `CargosSubmission` rows and runs the configured D4 **adapter** (MOCK, HTTP) per company (D5).
 * When idle, purges **CustomerDocument** rows past **`retentionUntil`** (B2): local file or S3 object + DB row.
 *
 * Requires: PostgreSQL (same `DATABASE_URL` as API). Optional: `docker compose` for Redis (unused in worker v1).
 *
 * Env: `WORKER_PROCESSING_STALE_MS` — re-queue stuck `PROCESSING` (default 15 min, min 60s)
 *      `WORKER_CARGOS_MOCK_DELAY_MS` — delay before MOCK success (default 400)
 *      `CARGOS_MAX_ATTEMPTS` — HTTP / adapter failure retries (default 5)
 *      `CARGOS_HTTP_TIMEOUT_MS` — fetch timeout (default 30_000)
 *      `CARGOS_HTTP_SECRET` — optional Bearer token for your CaRGOS middleware endpoint
 *      `WORKER_RETENTION_PURGE_BATCH` — max customer documents to purge per idle tick (default **25**; **0** = off)
 *      `WORKER_HEARTBEAT_LOG_MS` — optional idle heartbeat log interval for log-based liveness (default **0** = off; e.g. **300000** = 5 min)
 *      `STORAGE_LOCAL_ROOT` / `STORAGE_MODE` / `S3_*` — same semantics as API for blob delete
 *      `WORKER_API_BASE_URL` — API v1 prefix for cron calls (default `http://127.0.0.1:3000/v1`)
 *      `WORKER_INTERNAL_SECRET` — Bearer for `POST …/internal/cron/rent-payment-reminders` (≥16 chars; must match API)
 *      `WORKER_RENT_REMINDER_INTERVAL_MS` — min ms between reminder runs in idle loop (default **900000** = 15 min; **0** = disable)
 *      `SERVICE_DUE_AUTO_BLOCKS` — **1** / **true** with `WORKER_INTERNAL_SECRET` + API same env: worker may call `POST …/internal/cron/service-due-maintenance-blocks` (F3)
 *      `WORKER_SERVICE_DUE_INTERVAL_MS` — min ms between F3 runs in idle loop (default **3600000** = 1 h; **0** = disable)
 *      `WORKER_CUSTOMER_DOCUMENT_OCR_INTERVAL_MS` — min ms between `POST …/internal/cron/customer-document-ocr` (G3; default **0** = off; e.g. **900000** when API sets **`CUSTOMER_DOCUMENT_OCR_AUTO=mock`** or **`http`**). Async completions use `POST …/customer-document-ocr-callback` from your adapter (same `WORKER_INTERNAL_SECRET`), not this tick.
 *      `WORKER_PARTNER_WEBHOOK_INTERVAL_MS` — min ms between `POST …/internal/cron/partner-webhook-deliveries` (G2; default **0** = off; e.g. **60000** when partner webhooks are configured)
 */
import { PrismaClient } from '@prisma/client';
import { buildCargosHttpAdapterBody } from '@car-rental/shared';
import { purgeExpiredCustomerDocuments } from './purge-retention';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let sessionMockSent = 0;
let sessionFailed = 0;
let sessionSkipped = 0;
let sessionRetentionPurged = 0;

/** Long idle sleeps become interruptible so SIGTERM stops within ~200ms. */
async function sleepInterruptible(
  totalMs: number,
  isRunning: () => boolean,
  chunkMs = 200,
): Promise<void> {
  let left = totalMs;
  while (left > 0 && isRunning()) {
    const step = Math.min(chunkMs, left);
    await sleep(step);
    left -= step;
  }
}

function parseNonNegMs(s: string | undefined, def: number): number {
  if (!s) {
    return def;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function parsePosInt(s: string | undefined, def: number): number {
  if (!s) {
    return def;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 ? n : def;
}

/** Non-negative int; default when unset; **0** is valid (used to disable B2 purge). */
function parseNonNegIntEnv(s: string | undefined, def: number): number {
  if (s === undefined || s === '') {
    return def;
  }
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function cargosHttpHeaders(environment: 'TEST' | 'PRODUCTION'): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Cargos-Environment': environment,
    'X-Car-Rental-Integration': 'cargos',
  };
  const secret = process.env.CARGOS_HTTP_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

/** One line per terminal CaRGOS failure — easy to grep in Loki / CloudWatch / Datadog. */
function logCargosFailed(submissionId: string, reservationId: string, errorMessage: string): void {
  const err = errorMessage.replace(/\s+/g, ' ').trim().slice(0, 500);
  // eslint-disable-next-line no-console
  console.warn(
    `[cargos] FAILED submissionId=${submissionId} reservationId=${reservationId} error=${JSON.stringify(err)}`,
  );
}

/** Re-queue rows left in PROCESSING after a crash (e.g. worker killed mid-job). */
async function resetStaleProcessing(staleMs: number): Promise<number> {
  const threshold = Math.max(60_000, staleMs);
  const deadline = new Date(Date.now() - threshold);
  const r = await prisma.cargosSubmission.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: deadline } },
    data: { status: 'PENDING' },
  });
  return r.count;
}

type CompanyAdapterRow = {
  id: string;
  cargosInScope: boolean;
  cargosAdapter: 'MOCK' | 'HTTP' | 'OFF';
  cargosHttpUrl: string | null;
  cargosEnvironment: 'TEST' | 'PRODUCTION';
};

async function processOne(): Promise<boolean> {
  const pending = await prisma.cargosSubmission.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  if (!pending) {
    return false;
  }
  const lock = await prisma.cargosSubmission.updateMany({
    where: { id: pending.id, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  });
  if (lock.count === 0) {
    return true;
  }
  const maxAttempts = parsePosInt(process.env.CARGOS_MAX_ATTEMPTS, 5);
  const company = (await prisma.company.findUnique({ where: { id: pending.companyId } })) as CompanyAdapterRow | null;
  if (!company) {
    await prisma.cargosSubmission.update({
      where: { id: pending.id },
      data: { status: 'FAILED', errorMessage: 'Company not found', processedAt: new Date() },
    });
    logCargosFailed(pending.id, pending.reservationId, 'Company not found');
    sessionFailed += 1;
    return true;
  }
  if (!company.cargosInScope || company.cargosAdapter === 'OFF') {
    const msg = !company.cargosInScope ? 'In scope: false (D5)' : 'Adapter OFF (D5)';
    await prisma.cargosSubmission.update({
      where: { id: pending.id },
      data: { status: 'SKIPPED', processedAt: new Date(), errorMessage: msg },
    });
    sessionSkipped += 1;
    return true;
  }

  try {
    if (company.cargosAdapter === 'MOCK') {
      // eslint-disable-next-line no-console
      console.log(
        `[cargos] MOCK transmit id=${pending.id} reservation=${pending.reservationId} (D4)`,
      );
      await sleep(parseNonNegMs(process.env.WORKER_CARGOS_MOCK_DELAY_MS, 400));
      await prisma.cargosSubmission.update({
        where: { id: pending.id },
        data: { status: 'MOCK_SENT', processedAt: new Date(), errorMessage: null },
      });
      sessionMockSent += 1;
      return true;
    }
    if (company.cargosAdapter === 'HTTP') {
      const url = company.cargosHttpUrl?.trim();
      if (!url) {
        await failOrRequeue(
          pending.id,
          pending.reservationId,
          pending.attemptCount,
          maxAttempts,
          'cargosHttpUrl not set for HTTP',
        );
        return true;
      }
      const resRow = await prisma.reservation.findUnique({
        where: { id: pending.reservationId },
        include: {
          company: { select: { name: true } },
          pickupStation: { select: { name: true, code: true, cargosLocationCode: true } },
          vehicle: {
            select: {
              id: true,
              licensePlate: true,
              modelLabel: true,
              vin: true,
              vehicleType: true,
              vehicleClass: { select: { code: true, name: true } },
            },
          },
          customer: {
            select: { id: true, name: true, email: true, fiscalCode: true, vatNumber: true },
          },
          rentalAgreement: {
            select: { id: true, status: true, agreementTemplateVersion: true, signedAt: true },
          },
        },
      });
      if (!resRow) {
        await prisma.cargosSubmission.update({
          where: { id: pending.id },
          data: { status: 'FAILED', errorMessage: 'Reservation not found', processedAt: new Date() },
        });
        logCargosFailed(pending.id, pending.reservationId, 'Reservation not found');
        sessionFailed += 1;
        return true;
      }
      const timeout = parseNonNegMs(process.env.CARGOS_HTTP_TIMEOUT_MS, 30_000);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      const body = buildCargosHttpAdapterBody(pending, resRow, company.cargosEnvironment);
      const resp = await fetch(url, {
        method: 'POST',
        headers: cargosHttpHeaders(company.cargosEnvironment),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (resp.ok) {
        await prisma.cargosSubmission.update({
          where: { id: pending.id },
          data: { status: 'MOCK_SENT', processedAt: new Date(), errorMessage: null },
        });
        sessionMockSent += 1;
      } else {
        const ttxt = await resp.text().catch(() => '');
        await failOrRequeue(
          pending.id,
          pending.reservationId,
          pending.attemptCount,
          maxAttempts,
          `HTTP ${resp.status} ${ttxt?.slice(0, 500)}`,
        );
      }
      return true;
    }
    await prisma.cargosSubmission.update({
      where: { id: pending.id },
      data: { status: 'FAILED', errorMessage: `Unknown adapter: ${company.cargosAdapter}`, processedAt: new Date() },
    });
    logCargosFailed(pending.id, pending.reservationId, `Unknown adapter: ${company.cargosAdapter}`);
    sessionFailed += 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failOrRequeue(pending.id, pending.reservationId, pending.attemptCount, maxAttempts, msg);
  }
  return true;
}

async function purgeRetentionOnce(): Promise<void> {
  const batch = parseNonNegIntEnv(process.env.WORKER_RETENTION_PURGE_BATCH, 25);
  if (batch < 1) {
    return;
  }
  try {
    const n = await purgeExpiredCustomerDocuments(prisma, batch);
    if (n > 0) {
      sessionRetentionPurged += n;
      // eslint-disable-next-line no-console
      console.log(
        `[worker] B2 retention: purged ${n} customer document(s) (session total ${sessionRetentionPurged})`,
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[worker] B2 retention purge error:', e instanceof Error ? e.message : e);
  }
}

async function failOrRequeue(
  id: string,
  reservationId: string,
  attemptCount: number,
  maxAttempts: number,
  errMsg: string,
): Promise<void> {
  const next = attemptCount + 1;
  if (next >= maxAttempts) {
    const msg = errMsg.slice(0, 2000);
    await prisma.cargosSubmission.update({
      where: { id },
      data: { status: 'FAILED', errorMessage: msg, processedAt: new Date(), attemptCount: next },
    });
    logCargosFailed(id, reservationId, msg);
    sessionFailed += 1;
  } else {
    await prisma.cargosSubmission.update({
      where: { id },
      data: { status: 'PENDING', errorMessage: errMsg.slice(0, 2000), attemptCount: next },
    });
  }
}

let lastRentReminderTick = 0;
let lastServiceDueTick = 0;
let lastCustomerDocumentOcrTick = 0;
let lastPartnerWebhookTick = 0;

async function maybeTriggerRentPaymentReminders(): Promise<void> {
  const interval = parseNonNegMs(process.env.WORKER_RENT_REMINDER_INTERVAL_MS, 900_000);
  if (interval < 1) {
    return;
  }
  const secret = process.env.WORKER_INTERNAL_SECRET?.trim() ?? '';
  if (!secret || secret.length < 16) {
    return;
  }
  const rawBase = process.env.WORKER_API_BASE_URL?.trim() ?? 'http://127.0.0.1:3000/v1';
  const base = rawBase.replace(/\/$/, '');
  const now = Date.now();
  if (now - lastRentReminderTick < interval) {
    return;
  }
  lastRentReminderTick = now;
  try {
    const url = `${base}/internal/cron/rent-payment-reminders`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[worker] C2 rent reminders HTTP ${resp.status} ${body.slice(0, 200)}`,
      );
      return;
    }
    try {
      const j = JSON.parse(body) as { sent?: number; examined?: number; skipped?: string | null };
      if (typeof j.sent === 'number' && j.sent > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker] C2 rent reminders: sent=${j.sent} examined=${j.examined ?? '—'} skipped=${j.skipped ?? '—'}`,
        );
      }
    } catch {
      /* non-JSON ok */
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] C2 rent reminders fetch error: ${e instanceof Error ? e.message : e}`);
  }
}

async function maybeTriggerCustomerDocumentOcr(): Promise<void> {
  const interval = parseNonNegMs(process.env.WORKER_CUSTOMER_DOCUMENT_OCR_INTERVAL_MS, 0);
  if (interval < 1) {
    return;
  }
  const secret = process.env.WORKER_INTERNAL_SECRET?.trim() ?? '';
  if (!secret || secret.length < 16) {
    return;
  }
  const now = Date.now();
  if (now - lastCustomerDocumentOcrTick < interval) {
    return;
  }
  lastCustomerDocumentOcrTick = now;
  const rawBase = process.env.WORKER_API_BASE_URL?.trim() ?? 'http://127.0.0.1:3000/v1';
  const base = rawBase.replace(/\/$/, '');
  try {
    const url = `${base}/internal/cron/customer-document-ocr`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[worker] G3 customer-document-ocr HTTP ${resp.status} ${body.slice(0, 200)}`);
      return;
    }
    try {
      const j = JSON.parse(body) as {
        processed?: number;
        failed?: number;
        skipped?: boolean;
        batchLimit?: number;
      };
      if (j.skipped) {
        return;
      }
      const proc = typeof j.processed === 'number' ? j.processed : 0;
      const fail = typeof j.failed === 'number' ? j.failed : 0;
      if (proc > 0 || fail > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker] G3 customer-document-ocr: processed=${proc} failed=${fail} batchLimit=${j.batchLimit ?? '—'}`,
        );
      }
    } catch {
      /* non-JSON ok */
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[worker] G3 customer-document-ocr fetch error: ${e instanceof Error ? e.message : e}`,
    );
  }
}

async function maybeTriggerPartnerWebhookDeliveries(): Promise<void> {
  const interval = parseNonNegMs(process.env.WORKER_PARTNER_WEBHOOK_INTERVAL_MS, 0);
  if (interval < 1) {
    return;
  }
  const secret = process.env.WORKER_INTERNAL_SECRET?.trim() ?? '';
  if (!secret || secret.length < 16) {
    return;
  }
  const now = Date.now();
  if (now - lastPartnerWebhookTick < interval) {
    return;
  }
  lastPartnerWebhookTick = now;
  const rawBase = process.env.WORKER_API_BASE_URL?.trim() ?? 'http://127.0.0.1:3000/v1';
  const base = rawBase.replace(/\/$/, '');
  try {
    const url = `${base}/internal/cron/partner-webhook-deliveries`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[worker] G2 partner-webhook-deliveries HTTP ${resp.status} ${body.slice(0, 200)}`);
      return;
    }
    try {
      const j = JSON.parse(body) as {
        processed?: number;
        succeeded?: number;
        retried?: number;
        dead?: number;
        batchLimit?: number;
      };
      const proc = typeof j.processed === 'number' ? j.processed : 0;
      if (proc > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker] G2 partner webhooks: processed=${proc} ok=${j.succeeded ?? '—'} retried=${j.retried ?? '—'} dead=${j.dead ?? '—'} batchLimit=${j.batchLimit ?? '—'}`,
        );
      }
    } catch {
      /* non-JSON ok */
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[worker] G2 partner-webhook-deliveries fetch error: ${e instanceof Error ? e.message : e}`,
    );
  }
}

async function maybeTriggerServiceDueBlocks(): Promise<void> {
  const interval = parseNonNegMs(process.env.WORKER_SERVICE_DUE_INTERVAL_MS, 3_600_000);
  if (interval < 1) {
    return;
  }
  const secret = process.env.WORKER_INTERNAL_SECRET?.trim() ?? '';
  if (!secret || secret.length < 16) {
    return;
  }
  const now = Date.now();
  if (now - lastServiceDueTick < interval) {
    return;
  }
  lastServiceDueTick = now;
  const rawBase = process.env.WORKER_API_BASE_URL?.trim() ?? 'http://127.0.0.1:3000/v1';
  const base = rawBase.replace(/\/$/, '');
  try {
    const url = `${base}/internal/cron/service-due-maintenance-blocks`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[worker] F3 service-due blocks HTTP ${resp.status} ${body.slice(0, 200)}`);
      return;
    }
    try {
      const j = JSON.parse(body) as { created?: number; examined?: number; skipped?: string | null };
      if (typeof j.created === 'number' && j.created > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker] F3 service-due blocks: created=${j.created} examined=${j.examined ?? '—'} skipped=${j.skipped ?? '—'}`,
        );
      }
    } catch {
      /* non-JSON ok */
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[worker] F3 service-due blocks fetch error: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error('[worker] Set DATABASE_URL (same as API / Prisma) to run CaRGOS processor.');
    process.exit(1);
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[worker] Database unreachable:', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  const idle = parseNonNegMs(process.env.WORKER_POLL_IDLE_MS, 2000);
  const staleMs = parseNonNegMs(process.env.WORKER_PROCESSING_STALE_MS, 15 * 60 * 1000);
  const recovered = await resetStaleProcessing(staleMs);
  if (recovered > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[worker] Recovered ${recovered} stale PROCESSING → PENDING (threshold ${Math.max(60_000, staleMs)}ms; env WORKER_PROCESSING_STALE_MS).`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[worker] CaRGOS (D4/D5) + B2 retention purge started (idle=${idle}ms, CARGOS_MAX_ATTEMPTS=${parsePosInt(process.env.CARGOS_MAX_ATTEMPTS, 5)}, WORKER_RETENTION_PURGE_BATCH=${parseNonNegIntEnv(process.env.WORKER_RETENTION_PURGE_BATCH, 25)}, WORKER_HEARTBEAT_LOG_MS=${parseNonNegMs(process.env.WORKER_HEARTBEAT_LOG_MS, 0)}; single instance recommended).`,
  );
  let run = true;
  const heartbeatMs = parseNonNegMs(process.env.WORKER_HEARTBEAT_LOG_MS, 0);
  let lastHeartbeat = 0;
  const shutdown = async () => {
    if (!run) {
      return;
    }
    run = false;
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log(
      `[worker] Stopped. (CaRGOS MOCK/SENT: ${sessionMockSent}, SKIPPED: ${sessionSkipped}, FAILED: ${sessionFailed}; B2 docs purged: ${sessionRetentionPurged})`,
    );
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  while (run) {
    const did = await processOne();
    if (!did) {
      await purgeRetentionOnce();
      await maybeTriggerRentPaymentReminders();
      await maybeTriggerServiceDueBlocks();
      await maybeTriggerCustomerDocumentOcr();
      await maybeTriggerPartnerWebhookDeliveries();
      await sleepInterruptible(idle, () => run);
      if (heartbeatMs > 0 && run) {
        const now = Date.now();
        if (now - lastHeartbeat >= heartbeatMs) {
          lastHeartbeat = now;
          // eslint-disable-next-line no-console
          console.log(
            `[worker] heartbeat uptimeSec=${Math.floor(process.uptime())} sessionTotals={mockSent:${sessionMockSent},skipped:${sessionSkipped},failed:${sessionFailed},b2Purged:${sessionRetentionPurged}}`,
          );
        }
      }
    }
  }
}

void main();
