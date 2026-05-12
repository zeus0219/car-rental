# Staging environment (A1)

A **staging** stack mirrors **production** behavior (same Docker images, same `NODE_ENV=production` for the API so validation and CORS rules match real deploys) but uses **isolated** data and **non-production** money and police flows.

| Principle | Staging | Production |
|-----------|---------|------------|
| **Database** | Separate Postgres instance, volume, and `DATABASE_URL` — never the prod DSN. | Live customer data. |
| **JWT / secrets** | Own `JWT_SECRET` (≥32 chars); **different** from production. | Production secret only. |
| **CORS** | Origins of your **staging** web host (e.g. `https://desk-staging.example.com`). | Your real public desk URLs. |
| **Stripe** | **Test mode only** — `sk_test_...`, test webhook `whsec_...` from a [test-mode](https://docs.stripe.com/keys#test-and-live-modes) dashboard or `stripe listen`. | **Live** `sk_live_...` and live webhook. |
| **CaRGOS** | **Stub worker** only (MOCK_SENT). Do **not** use Questura / Polizia **production** credentials. | Real adapter and credentials when you go live. |
| **Redis (A6)** | Sample compose includes **`redis:7-alpine`**; **`REDIS_URL=redis://redis:6379`** in `deploy/.env.staging.example` for shared HTTP rate limits when you scale the API. | Same pattern in prod (managed Redis URL in production). |
| **Naming** | Hostnames, S3/MinIO buckets, and DSNs should include **`staging`** (or a non-prod name) to avoid mix-ups. | — |

**Apply migrations** to the staging DB the same way as production: `npx prisma migrate deploy` with **staging** `DATABASE_URL` (see [PRODUCTION.md](PRODUCTION.md)). **Backups / restore drills:** [PRODUCTION.md § PostgreSQL backups](PRODUCTION.md#postgresql-backups-and-restore-rpo--rto) (staging often tolerates a looser RPO; still practice a restore yearly).

## Quick start (Docker, from repository root)

**Architecture reference:** component list and optional Redis/worker placement — [PRODUCTION.md § Production topology](PRODUCTION.md#production-topology-reference). **Monitoring:** [PRODUCTION.md § Observability](PRODUCTION.md#observability). **Pre-launch QA + rollback:** [PRODUCTION.md § Pre-launch QA](PRODUCTION.md#pre-launch-qa-and-rollback). **Desk handover / damage (D3, F1, F2):** [PRODUCTION.md § Desk handover](PRODUCTION.md#desk-handover-return-and-damage-d3-f1-f2). **GDPR / retention (B4, B2):** [PRODUCTION.md § GDPR](PRODUCTION.md#gdpr-and-customer-data-b4-b2). **Rental agreements / e-sign (D1, D2):** [PRODUCTION.md § Legal](PRODUCTION.md#legal-rental-agreements-e-sign-and-counsel-d1-d2). **CaRGOS worker / middleware (D4–D6):** [PRODUCTION.md § CaRGOS](PRODUCTION.md#cargos-worker-middleware-and-operations-d4-d5-d6). **Invoices / SDI (E3, E4):** [PRODUCTION.md § Invoices and SDI](PRODUCTION.md#invoices-and-sdi-e3-e4). **Reconciliation / reports (E1, G1):** [PRODUCTION.md § Reconciliation and reports](PRODUCTION.md#reconciliation-and-company-reports-e1-g1).

1. Copy the example env:

   ```bash
   copy deploy\.env.staging.example deploy\.env.staging
   # or: cp on Unix — edit with strong secrets
   ```

2. Build and run the **staging** compose file (different volume + ports from `docker-compose.prod.yml`):

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --env-file deploy/.env.staging up -d --build
   ```

3. Run migrations **against the staging database** (from dev machine with network access, or a CI job):

   ```bash
   set DATABASE_URL=postgresql://...staging...
   cd apps/api && npx prisma migrate deploy
   ```

4. Web build args must point the browser at the **staging** API URL (`NEXT_PUBLIC_API_URL` in `deploy/.env.staging`).

5. (Optional) Seed staging with `npm run db:seed` using **staging** `DATABASE_URL` — use non-production emails/passwords.

6. **Worker** is included in `docker-compose.staging.yml` (CaRGOS queue + B2 retention). Use **`WORKER_RETENTION_PURGE_BATCH`** and the same **`STORAGE_*` / `S3_*`** values as the API in `deploy/.env.staging` when you rely on document purge or S3. Optional **G2:** set shared **`WORKER_INTERNAL_SECRET`** (≥16 chars) + **`WORKER_API_BASE_URL`** (`http://api:3000/v1` in Compose) and **`WORKER_PARTNER_WEBHOOK_INTERVAL_MS`** (e.g. `60000`) to exercise **`PartnerWebhookDelivery`** from the worker; confirm desk **Organization** delivery log and **`/health/summary`** **`partnerWebhookPending`** ([PRODUCTION.md](PRODUCTION.md#partner-api-and-document-ocr-g2-g3)).

## Verify Redis-backed throttling (staging)

1. Start the stack (`docker compose … up -d`) and **`docker compose … logs api`** — expect **`HTTP rate limits: Redis storage`** from the `Throttler` logger.
2. Optional: generate traffic and inspect keys — `docker compose … exec redis redis-cli KEYS 'throttler:*'` should list entries while requests are rate-limited.
3. For **local dev** (`npm run dev:api` without Redis), expect **`in-memory`** in logs; add **`REDIS_URL`** to `apps/api/.env` to match Docker staging.

## Local development vs staging

| Mode | Use case |
|------|----------|
| `npm run dev:api` + `dev -w @car-rental/web` | **Local** dev, `development` `NODE_ENV`, `JWT_SECRET=change-me` allowed. |
| Staging in Docker (this doc) | **Shared** UAT, demos, pre-prod; behaves like **production** for API validation. |

## Stripe checklist (staging)

Live go-live checklist: [PRODUCTION.md § Stripe (payments)](PRODUCTION.md#stripe-payments). **Email / SMTP:** [PRODUCTION.md § Email (transactional)](PRODUCTION.md#email-transactional). **S3:** [PRODUCTION.md § Object storage: S3 and MinIO](PRODUCTION.md#object-storage-s3-and-minio) (staging bucket + CORS origins for staging hosts).

- [ ] [Dashboard](https://dashboard.stripe.com/test) is in **Test mode** when you copy the secret key.  
- [ ] Webhook endpoint (or `stripe listen`) uses a **test** signing secret.  
- [ ] Webhook listens for **`checkout.session.completed`** plus **`checkout.session.async_payment_succeeded`** / **`checkout.session.async_payment_failed`** if you test delayed payment methods; public **`/quote`** smoke — [PRODUCTION.md § Stripe](PRODUCTION.md#stripe-payments) (C1/C2/E2).  
- [ ] Checkout success/cancel URLs use **staging** hostnames, not `localhost` in shared environments.

## Checklist (staging readiness)

- [ ] Separate `DATABASE_URL` and backup policy for staging (often smaller RPO is OK).  
- [ ] `JWT_SECRET` and `CORS_ORIGINS` unique to staging.  
- [ ] No production Stripe live keys in staging config.  
- [ ] No production CaRGOS / Polizia production endpoints (stub only until you have a test channel). Desk companies use **`cargosEnvironment`** **TEST** and **`MOCK`** or a **non-production** middleware URL ([PRODUCTION.md § CaRGOS](PRODUCTION.md#cargos-worker-middleware-and-operations-d4-d5-d6)).
- [ ] **`docker compose … logs api`** shows **`HTTP rate limits: Redis storage`** when using bundled Redis (A6).
- [ ] **A2 / A3:** `AUTH_LOGIN_MAX_ATTEMPTS` / lockout and optional **`AUTH_MFA_REQUIRED`** match your policy ([PRODUCTION.md § Authentication hardening](PRODUCTION.md#authentication-hardening-a2-a3-h1)).
- [ ] If **SMTP** is configured: **`APP_PUBLIC_BASE_URL`** is the staging web origin (see [PRODUCTION.md § Email](PRODUCTION.md#email-transactional)).  
- [ ] If **`STORAGE_MODE=s3`**: staging bucket and **CORS** allow staging **`CORS_ORIGINS`** for presigned `PUT`; worker **`S3_*`** matches API ([PRODUCTION.md § Object storage: S3 and MinIO](PRODUCTION.md#object-storage-s3-and-minio)).
- [ ] **`HANDOVER_*`** / **`CARGOS_AUTO_ENQUEUE_ON_SIGN`** on the API match how you test handover in staging ([PRODUCTION.md § Desk handover](PRODUCTION.md#desk-handover-return-and-damage-d3-f1-f2)).
- [ ] **B2:** With worker + **`WORKER_RETENTION_PURGE_BATCH` > 0**, exercise a **`CustomerDocument`** past **`retentionUntil`** and confirm purge logs + object removal ([PRODUCTION.md § GDPR](PRODUCTION.md#gdpr-and-customer-data-b4-b2)).
- [ ] **E3 / E4:** Company **`sdiAdapter`** is **OFF** or **MOCK** on staging (no live **`sdiHttpUrl`** to production SDI); invoice smoke matches [PRODUCTION.md § Invoices and SDI](PRODUCTION.md#invoices-and-sdi-e3-e4).
- [ ] **E1 / G1:** Spot-check **reconciliation** CSV + **company report** against test Stripe bookings for a short UTC window ([PRODUCTION.md § Reconciliation and reports](PRODUCTION.md#reconciliation-and-company-reports-e1-g1)).
- [ ] **G2 (optional):** If you test **partner** webhooks in staging, use HTTPS mock endpoints only; wire **`WORKER_INTERNAL_SECRET`** + optional **`WORKER_PARTNER_WEBHOOK_INTERVAL_MS`** on the worker; review **Organization** delivery rows after a **`POST /v1/partner/reservations`** ([PRODUCTION.md § Partner API](PRODUCTION.md#partner-api-and-document-ocr-g2-g3)).
- [ ] **D1 / D2:** Staging agreements use **test-only** template ids / copy; **`signedClientIp`** checked with **`TRUST_PROXY`** as in prod ([PRODUCTION.md § Legal](PRODUCTION.md#legal-rental-agreements-e-sign-and-counsel-d1-d2)).
- [ ] **Pre-production:** run **[PRODUCTION.md § Pre-launch QA](PRODUCTION.md#pre-launch-qa-and-rollback)** smoke table on this stack; keep **image digests / git SHA** for rollback drills.
- [ ] Team knows staging is **resettable** (you may `db push` or restore from a template).

---

**Backlog link:** [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) — item **A1** is satisfied by this document plus `deploy/docker-compose.staging.yml` and `*.staging.example` env files.
