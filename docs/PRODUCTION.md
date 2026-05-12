# Production deployment

This repo is a **technical scaffold**: business features (full public booking, e-invoicing / SDI, real CaRGOS to Polizia, advanced fraud controls) are **out of scope** until you implement them with qualified counsel and operations. The notes below describe how to run the **existing** API, web, worker, and database in a production-like way.

## What is included in the codebase

| Area | Notes |
|------|--------|
| **API** | NestJS `v1`, JWT auth, Prisma, Stripe (optional), optional **SMTP** (acknowledges public saved quotes by email), rental agreements + uploads, CaRGOS **stub** queue, **invoices** (E3) + **SDI handoff** (E4) to HTTP middleware, **Stripe reconciliation** (E1) + **company reports** (G1), public quote + optional `QUOTE` draft, throttling (**in-memory** by default; **Redis** when **`REDIS_URL`** — A6 multi-instance), `helmet`, CORS, env validation in production |
| **Web** | Next.js desk + public `/quote`, security headers, `standalone` output for Docker |
| **Worker** | CaRGOS stub (DB poll) + **B2** retention purge for customer KYC documents — separate process |
| **DB** | PostgreSQL; apply migrations with `prisma migrate deploy` |

**Staging (separate DB, test Stripe, no prod credentials):** [STAGING.md](STAGING.md) — `deploy/docker-compose.staging.yml`, `deploy/.env.staging.example`.

## Production topology (reference)

Use this when drawing your own diagram or checking env coverage. **Staging** should mirror this shape with isolated resources — see [STAGING.md](STAGING.md).

| Component | Role | Notes |
|-----------|------|--------|
| **Web** (Next.js) | Browser UI: desk, `/quote`, `/auth`, `/booking/view` | Build-time: `NEXT_PUBLIC_API_URL` (public API `…/v1`), optional `NEXT_PUBLIC_DEFAULT_COMPANY_ID`, optional **`NEXT_PUBLIC_VAT_RATE`**. **Desk** reservations: handover gate (D3), ops photos, damage — see [§ Desk handover](#desk-handover-return-and-damage-d3-f1-f2). **Rental agreements:** template id + e-sign — [§ Legal](#legal-rental-agreements-e-sign-and-counsel-d1-d2). **Desk** `/desk/customers`: consents + GDPR export / anonymize — [§ GDPR](#gdpr-and-customer-data-b4-b2). **Desk** `/desk/invoices` + Organization fiscal/SDI — [§ Invoices and SDI](#invoices-and-sdi-e3-e4). **`/desk/reconciliation`**, **`/desk/reports`** — [§ Reconciliation and reports](#reconciliation-and-company-reports-e1-g1). |
| **API** (NestJS) | `/v1/*` REST, JWT, Stripe webhooks, presigns, mail, invoices + SDI enqueue, reconciliation + reports | Behind TLS + reverse proxy; set **`TRUST_PROXY=true`** when the API sits behind nginx/ALB/Cloud Run so client IP and rate limits use **`X-Forwarded-For`** (also required for meaningful **`signedClientIp`** on rental agreement **sign** — [§ Legal](#legal-rental-agreements-e-sign-and-counsel-d1-d2)). **E3/E4:** [`invoice.controller.ts`](../apps/api/src/invoice/invoice.controller.ts), [`sdi.controller.ts`](../apps/api/src/integrations/sdi/sdi.controller.ts) — [§ Invoices and SDI](#invoices-and-sdi-e3-e4). **E1/G1:** [`payments.controller.ts`](../apps/api/src/payments/payments.controller.ts), [`reports.controller.ts`](../apps/api/src/reports/reports.controller.ts) — [§ Reconciliation and reports](#reconciliation-and-company-reports-e1-g1). |
| **PostgreSQL** | Prisma / all domain data | Dedicated instance or managed DB; TLS in cloud. **Backups and restore drills:** [§ PostgreSQL backups](#postgresql-backups-and-restore-rpo--rto). |
| **Worker** (Node) | CaRGOS queue poll + optional **B2** document retention purge | Same `DATABASE_URL` (and storage env) as API. **`deploy/docker-compose.prod.yml`** and **`deploy/docker-compose.staging.yml`** include a `worker` service; otherwise run [`Dockerfile.worker`](../deploy/Dockerfile.worker) or `node apps/worker/dist/main.js` as a separate deployment. **HTTP adapter URL** (`cargosHttpUrl`) lives in the **DB** per company — [§ CaRGOS production](#cargos-worker-middleware-and-operations-d4-d5-d6). |
| **Redis** (optional) | Shared HTTP rate limits across **multiple** API replicas | Set `REDIS_URL` on API (e.g. `redis://redis:6379` inside Docker Compose). **`deploy/docker-compose.prod.yml`** / **`.staging.yml`** include a **`redis:7-alpine`** service; API logs `HTTP rate limits: Redis storage` on boot when wired. Omit Redis only for a **single** API process (in-memory throttler). |
| **Stripe** | Payments, webhooks | Live keys only in production; webhook URL hits API (`/v1/payments/...` per your config). |
| **Object storage** (optional) | S3-compatible: agreements, customer docs, ops photos | See [§ Object storage: S3 and MinIO](#object-storage-s3-and-minio); worker must use the same **`STORAGE_*` / `S3_*`** as the API for B2 retention deletes. |
| **SMTP** (optional) | Transactional email | If unset, API skips outbound mail. |

**Traffic flow (typical):** Browser → **Web** (static/server) → browser calls **API** on configured origin (CORS must list the web origin). Staff and customers never talk to Postgres or Redis directly.

## API environment validation (fail-fast)

On boot, `validateEnv` ([`apps/api/src/config/env.validation.ts`](../apps/api/src/config/env.validation.ts)) runs via Nest `ConfigModule`. In **`NODE_ENV=production`** it enforces:

| Variable | Rule |
|----------|------|
| `DATABASE_URL` | Non-empty |
| `JWT_SECRET` | At least **32** characters, not a obvious **placeholder** substring (e.g. `change-me`, `dev-insecure`) |
| `CORS_ORIGINS` | **Required** — comma-separated browser origins (no wildcard); omitting falls back to localhost-only in dev, but production **fails to start** if unset |
| `TRUST_PROXY` | Optional boolean; when true, Express `trust proxy` is enabled in [`main.ts`](../apps/api/src/main.ts) |

Other keys (`REDIS_URL`, SMTP, `SWAGGER_ENABLE`, A2 lockout, A3 MFA policy, etc.) are optional with defaults documented in [`apps/api/.env.example`](../apps/api/.env.example).

## Authentication hardening (A2, A3, H1)

| Track | Behavior in this repo |
|-------|------------------------|
| **A2 — Throttles & lockout** | **`POST /v1/auth/login`** uses **`@Throttle(5, 60s)`** per IP (stricter than the global default **200/min**). Set **`AUTH_LOGIN_MAX_ATTEMPTS`** (e.g. **8**) and **`AUTH_LOGIN_LOCKOUT_MINUTES`** (default **15**) so repeated **wrong passwords** or **wrong TOTP / recovery codes** during the MFA step increment **`failedLoginAttempts`** and set **`lockedUntil`** on the user (works with **Redis-backed** throttler for IP limits; lockout is **in the database** so it is correct across API replicas). **`0`** or omit **`AUTH_LOGIN_MAX_ATTEMPTS`** disables lockout (discouraged in real production). |
| **A3 — MFA policy** | **TOTP** + **recovery codes** for **`ADMIN`** and **`BRANCH_MANAGER`** ([`AuthService`](../apps/api/src/auth/auth.service.ts), desk **Account**). If enrollment was **started** but not **confirmed**, password sign-in returns a short-lived **`mfa_setup`** access token (JWT) that only allows **`GET /auth/me`**, **`POST /auth/mfa/setup/confirm`**, and **`POST /auth/mfa/setup/cancel`** until the user confirms or cancels ([`JwtAuthGuard`](../apps/api/src/auth/jwt-auth.guard.ts)). Optional enforcement: **`AUTH_MFA_REQUIRED=true`** — privileged users **without** MFA (and not in **pending setup**) **cannot** complete sign-in; full JWTs are rejected by [`JwtStrategy`](../apps/api/src/auth/jwt.strategy.ts) once MFA is required. **Bootstrap:** leave **`AUTH_MFA_REQUIRED`** unset until every privileged user has enrolled MFA (or use pending setup from an existing session), then enable. While enabled, **`POST /auth/mfa/disable`** is **rejected** for those roles. **STAFF** and other roles are unchanged. |
| **H1 — OpenAPI `/docs`** | In **`NODE_ENV=production`**, **`GET /docs`** and **`/docs-json`** are **off** unless **`SWAGGER_ENABLE=1`**/`true` ([`main.ts`](../apps/api/src/main.ts)). If you enable Swagger in production, **do not** expose it on the public internet — restrict by **VPN**, **private network**, **`allow`/`deny` in nginx**, or an **authenticated** reverse proxy. |

Docker Compose passes **`AUTH_*`**, **`SWAGGER_ENABLE`** on the **api** service ([`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml), [`deploy/docker-compose.staging.yml`](../deploy/docker-compose.staging.yml)); sample values are in **[`deploy/.env.prod.example`](../deploy/.env.prod.example)**.

## Secrets in production (ops)

Do **not** commit real secrets. Prefer your platform’s **secret manager** (e.g. AWS Secrets Manager / SSM Parameter Store, GCP Secret Manager, Azure Key Vault, Kubernetes **Secrets** mounted as env vars) and inject **`JWT_SECRET`**, **`DATABASE_URL`**, **Stripe** keys, **SMTP** credentials, and **S3** keys at deploy time. Same pattern for **`deploy/.env`** in Compose-based demos: keep the file out of git and restrict file permissions (e.g. `chmod 600`).

## Stripe (payments)

Payments are optional until you set **`STRIPE_SECRET_KEY`**. For **live** traffic:

| Item | Notes |
|------|--------|
| **Secret key** | `STRIPE_SECRET_KEY` — use **`sk_live_…`** only in real production; **`sk_test_…`** on staging ([STAGING.md](STAGING.md)). |
| **Webhook** | In [Stripe Dashboard](https://dashboard.stripe.com/) (correct **mode**), add endpoint **`https://<your-api-host>/v1/payments/stripe/webhook`** — the API verifies signatures with **`STRIPE_WEBHOOK_SECRET`** (`whsec_…`). Copy the **signing secret** for the same mode as the API key. |
| **Webhook events** | Minimum: **`checkout.session.completed`**. Also enable **`checkout.session.async_payment_succeeded`** and **`checkout.session.async_payment_failed`** so **delayed** payment methods (**E2**) and async failures update the app / logs ([`payments.service.ts`](../apps/api/src/payments/payments.service.ts) `handleStripeWebhook`). All paths stay **idempotent** via **`ProcessedStripeEvent`**. |
| **Desk Checkout URLs** | **`STRIPE_CHECKOUT_SUCCESS_URL`** / **`STRIPE_CHECKOUT_CANCEL_URL`** — **https**, your real desk host; include **`{CHECKOUT_SESSION_ID}`** in the success URL where Stripe should substitute (see [`payments.service.ts`](../apps/api/src/payments/payments.service.ts) defaults). |
| **Public /quote URLs** | **`STRIPE_PUBLIC_CHECKOUT_SUCCESS_URL`** / **`STRIPE_PUBLIC_CHECKOUT_CANCEL_URL`** — same idea for customer-facing Checkout after paying a quote. **`APP_PUBLIC_BASE_URL`** must be the **Next** origin (links in emails + default success/cancel URLs). |
| **Raw body** | The webhook route requires the **raw** request body for signature verification; the Nest app enables **`rawBody: true`** in [`main.ts`](../apps/api/src/main.ts). Do not put a JSON body transformer in front of this path on your reverse proxy. |

### Public quote → pay → status (C1 / C2) and SCA / delayed payment (E2)

| Step | What happens |
|------|----------------|
| **1. Estimate** | Browser **`GET /v1/public/quote`** (and catalog) — no login. |
| **2. Save quote** | **`POST /v1/public/quote-reservations`** creates a **`PUBLIC_WEB`** reservation (vehicle held per your rules); response includes **`publicViewToken`** (stored in **`sessionStorage`** on the `/quote` page when possible). |
| **3. Pay rent** | **`POST /v1/payments/stripe/public/reservations/:id/rental-checkout`** with body **`{ "customerEmail": "…" }`** must match the reservation email — returns Stripe Checkout **`url`**. **SCA / 3DS** is completed on Stripe’s **hosted** Checkout page (no extra API code in v1). |
| **4. Webhook** | **`paidAt`** + status (**`CONFIRMED`**) are set from **`checkout.session.completed`** when **`payment_status`** is **`paid`**, or from **`checkout.session.async_payment_succeeded`** for methods that settle later (**E2**). |
| **5. Status** | Customer opens **`/booking/view?token=…`** — **`GET /v1/public/reservations/by-view-token`**. After Stripe redirects, **`/quote`** may show a success banner with a link to the same view when **`sessionStorage`** still has the token. |

If Checkout is **cancelled**, the customer keeps the quote and can retry. **`checkout.session.async_payment_failed`** is **logged** (warn); alert on that pattern in central logs if you offer async methods.

**Smoke checklist (before go-live):**

1. **Rental:** From the desk, start Checkout for a reservation → complete payment in Stripe → confirm **`paidAt`** / status via webhook (and optional customer email if SMTP is on).  
2. **Deposit:** Deposit Checkout → webhook updates deposit hold; test **capture** / **cancel** via desk if you use holds.  
3. **Refund:** **`POST /v1/payments/stripe/reservations/:reservationId/refund`** (JWT) with body from shared `createStripeRefundBodySchema` — verify in Stripe Dashboard; refund lines are not fully duplicated in the DB (use **Reconciliation** / Stripe for accounting — PRODUCTION-READINESS **E1**).  
4. **Public /quote (C1/C2):** Save a quote on **`/quote`** → pay with the **same email** → confirm webhook **`paidAt`** → open **`/booking/view?token=…`**; in the Stripe Dashboard, select **`checkout.session.async_payment_succeeded`** and **`checkout.session.async_payment_failed`** if you test **delayed** payment methods.  
5. **E1 / G1** — Export **reconciliation** and open **company report** for the same UTC window; confirm counts make sense with test checkouts ([PRODUCTION.md § Reconciliation and reports](PRODUCTION.md#reconciliation-and-company-reports-e1-g1)).

### Alternate PSPs (E5)

The repo implements **Stripe** only: Checkout sessions, PaymentIntents (deposit holds), webhooks, **`ProcessedStripeEvent`** idempotency, desk/public flows, and **`GET /v1/payments/stripe/reconciliation`**. There is **no** second PSP adapter in v1.

If **legal or commercial** terms require a different acquirer (e.g. Italian bank, **Nexi**, **Adyen**):

1. **Governance** — Align **PSD2 / SCA**, dispute windows, and MIF/pricing with counsel and the PSP **before** engineering commits.
2. **Domain mapping** — Decide how **capture**, **refunds**, and **deposit holds** map to existing **`Reservation`** fields (`paidAt`, `depositHoldStatus`, Stripe-specific columns) or whether to add **`paymentProvider`** + generic external ids + parallel webhook tables.
3. **Exports** — Reconciliation is **Stripe-shaped**; another provider needs its own settlement export, or a unified **`PaymentLedger`** / accounting view maintained outside this CSV.
4. **Operations** — Separate webhook URLs and secrets (**A4**), test vs live keys on **staging**, and runbooks for partial outages (Redis throttler vs PSP — [§ Observability](#observability)).

**Desk:** **`/desk/reconciliation`** includes a collapsible **E5** note (EN/IT) pointing here.

Docker Compose: pass Stripe variables into the **api** service ([`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml)).

## Email (transactional)

**C2 / H2 / C3** — implemented in [`MailService`](../apps/api/src/mail/mail.service.ts). At boot, if **`SMTP_HOST`** is unset the API logs that email is **disabled**. If **`SMTP_HOST`** is set but **`SMTP_FROM`** is missing, mail stays off (warning log).

| Variable | Purpose |
|----------|--------|
| `SMTP_HOST` | SMTP relay hostname — required to send |
| `SMTP_PORT` | Default **587** if omitted |
| `SMTP_SECURE` | `true` / `1` for port **465** (TLS immediately) |
| `SMTP_USER` / `SMTP_PASS` | Provider authentication when required |
| `SMTP_FROM` | From address (required whenever `SMTP_HOST` is set) |
| `APP_PUBLIC_BASE_URL` | Public **Next.js** site ( **`https://…`**, no trailing slash) — **not** the API host. Used for links to **`/quote`**, **`/booking/view?token=…`** (C3), **`/auth/reset-password?token=…`** (H2), and some Stripe-related copy. Wrong value → broken links in customer/staff inboxes. |
| `PASSWORD_RESET_TTL_MINUTES` | Forgot-password link lifetime (**5–1440**, default **60**) |
| `EMAIL_STRIPE_CHECKOUT_LINKS` | `false` / `0` / `no` — do **not** email customers when desk creates a Stripe Checkout link (rental/deposit). Omit to send when SMTP is on. |
| `EMAIL_STRIPE_WEBHOOK_EMAILS` | `false` / `0` / `no` — skip **rental paid** and **deposit hold** emails fired from Stripe webhooks. Omit to send. |

Docker Compose: SMTP and related keys are passed through on the **api** service in **`deploy/docker-compose.prod.yml`** and **`deploy/docker-compose.staging.yml`** (see [`deploy/.env.prod.example`](../deploy/.env.prod.example)).

**Checklist**

- [ ] **SPF / DKIM / DMARC** (or provider defaults) for the domain you use in **`SMTP_FROM`**.  
- [ ] **`APP_PUBLIC_BASE_URL`** matches the URL users type in the browser for the marketing/desk site.  
- [ ] Smoke: public **save quote** acknowledgment; **forgot password** (H2); optional Stripe-related messages with your **`EMAIL_STRIPE_*`** choices.

## Object storage: S3 and MinIO

Use **`STORAGE_MODE=s3`** when you run **more than one API replica** without a shared filesystem, or when you prefer blobs outside the container. The API then issues **presigned PUT** URLs; the **browser uploads directly** to the bucket. **Do not** rely on a local **`STORAGE_LOCAL_ROOT`** volume across replicas — each instance would see different files.

**Features that use this bucket** (same `STORAGE_MODE` for all):

| Flow | Keys (under one `S3_BUCKET`) |
|------|------------------------------|
| **Rental agreement** attachments | `{companyId}/{agreementId}/{fileId}.{ext}` |
| **Customer** KYC documents | `{companyId}/customers/{customerId}/{fileId}.{ext}` |
| **Reservation ops** (handover / damage photos) | `{companyId}/reservation-ops/{reservationId}/op|dmg/{fileId}.{ext}` |

With **`STORAGE_MODE=s3`**, multipart uploads **to the API** for these flows are **disabled** — clients must **presign → PUT → complete** (see [`CODEBASE.md`](CODEBASE.md) rental agreements / customer documents).

| Variable | Purpose |
|----------|---------|
| `STORAGE_MODE` | `s3` (or `local` — default) |
| `S3_REGION` | e.g. `eu-west-1` |
| `S3_BUCKET` | Single bucket for all prefixes above |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | IAM user or MinIO access key (inject via secret manager) |
| `S3_ENDPOINT` | Omit for **AWS**; set to MinIO base URL (e.g. `https://minio.internal:9000`) for S3-compatible servers |
| `S3_USE_PATH_STYLE` | Default **`true`** in code — keep for **MinIO**; set `false` for most **AWS** SDK virtual-hosted endpoints if required |
| `STORAGE_LOCAL_ROOT` | Ignored for API blob IO when `STORAGE_MODE=s3`; worker still uses it only in local mode |

**Worker:** Set the **same** `STORAGE_MODE` and `S3_*` values on the **worker** service. The B2 retention job deletes **`CustomerDocument`** rows and removes the object from S3; mismatched credentials skip or fail deletes ([`apps/worker/src/purge-retention.ts`](../apps/worker/src/purge-retention.ts)).

**IAM (AWS) — least privilege:** Attach a policy to a dedicated user/role used only by API + worker, scoped to the bucket:

- `s3:PutObject`, `s3:GetObject`, `s3:HeadObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`
- No `s3:ListBucket` required for the current code paths unless you add tooling
- Enable **Block Public Access** on the account/bucket; objects stay private; access is via **presigned** URLs and server-side `GetObject`

**CORS on the bucket** — required for **browser** `PUT` to presigned URLs. Allowed **Origins** must include every origin you list in **`CORS_ORIGINS`** (desk + public site if both upload). Example shape (adjust hosts):

```json
[
  {
    "AllowedOrigins": ["https://desk.example.com", "https://www.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

For **MinIO**, configure the equivalent CORS on the bucket (see [MinIO CORS](https://min.io/docs/minio/linux/administration/object-management.html#configure-the-cors)).

**Docker Compose:** `deploy/docker-compose.prod.yml` and **`deploy/docker-compose.staging.yml`** pass **`STORAGE_*` / `S3_*`** into **api** and **worker** from your env file. Copy commented examples from [`deploy/.env.prod.example`](../deploy/.env.prod.example).

**Smoke checklist**

- [ ] API boots with `STORAGE_MODE=s3` and no missing-var error from [`ObjectStorageS3Service`](../apps/api/src/rental-agreement/object-storage-s3.service.ts).  
- [ ] From the desk: presign → **PUT** succeeds (browser network tab shows **200** to S3/MinIO, not blocked by CORS).  
- [ ] Download / complete flows still work; worker retention delete works in a staging bucket if you test B2 purge.

## Required environment (API)

| Variable | Production |
|----------|------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string (TLS recommended for managed DBs) |
| `JWT_SECRET` | **≥ 32 characters**, random |
| `CORS_ORIGINS` | **Required** — comma-separated browser origins (e.g. `https://desk.example.com,https://www.example.com`) |
| `PORT` | e.g. `3000` |
| `TRUST_PROXY` | `true` when behind a reverse proxy or load balancer so client IP and rate limits use `X-Forwarded-For` correctly |
| `REDIS_URL` | **Optional (A6).** e.g. `redis://redis:6379` — when set, HTTP rate limits use Redis (shared across API replicas). Omit for single-instance / dev (in-memory throttler). |

**Transactional email:** [§ Email (transactional)](#email-transactional) — `SMTP_*`, `APP_PUBLIC_BASE_URL`, `PASSWORD_RESET_TTL_MINUTES`, `EMAIL_STRIPE_*`.

**Object storage:** [§ Object storage: S3 and MinIO](#object-storage-s3-and-minio) — `STORAGE_MODE`, `S3_*`, worker parity, IAM, CORS.

Copy from [`apps/api/.env.example`](../apps/api/.env.example) and set Stripe, S3, SMTP, etc. as needed. **Live Stripe** webhook URL, keys, and smoke tests: [§ Stripe (payments)](#stripe-payments) above.

## Web (build-time and runtime)

| Variable | Purpose |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | Public API base, e.g. `https://api.example.com/v1` |
| `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | Optional: prefill company on `/quote` |
| `NEXT_PUBLIC_VAT_RATE` | Optional: desk display only |

Set at **build** time for Next.js public env vars (they are inlined into the client bundle).

## Database migrations

**Do not** run `prisma migrate dev` in production. Use:

```bash
cd apps/api
# DATABASE_URL=... must point at the production database
npx prisma migrate deploy
```

Run this in **CI** after tests and before rolling out new API containers, or as a one-off job with the same `DATABASE_URL` the app uses. The production Docker image does not run migrations on container start (avoids race conditions and keeps the runtime image free of the Prisma CLI).

## PostgreSQL backups and restore (RPO / RTO)

**RPO (recovery point objective)** is the maximum **data loss** you accept — usually “how old can the latest backup be?” **RTO (recovery time objective)** is the maximum **downtime** to get the app back on a restored database. Set targets with your business; implement backups and **tested restores** to match.

| Deployment | Guidance |
|------------|----------|
| **Managed PostgreSQL** (RDS, Azure Database, Cloud SQL, Neon, etc.) | Use the provider’s **automated backups** and, where available, **point-in-time recovery (PITR)**. Document the console location, retention, and who can start a restore. This is the default recommendation for real production. |
| **Docker Compose** ([`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml)) | Data lives in the **`car_rental_prod_pg`** volume. The repo does **not** schedule backups — you must run **`pg_dump`** (or volume snapshots) on a **cron** / pipeline and store files **off-host**, **encrypted** (e.g. SSE-KMS on S3, or age/GPG), with retention and access logging. |

**Logical dumps (Compose-friendly):** from the repo root, with your real compose project name and env file (password is **not** shown on the command line; use the same vars as the `postgres` service):

```bash
# Writes a custom-format dump to the current directory on the host (add a timestamp in CI/cron).
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec -T postgres \
  pg_dump -U carrental -d carrental --no-owner --format=custom \
  > "carrental.dump"
```

Restore (to a **new** empty database) typically uses **`pg_restore`** from the same Postgres major version; follow PostgreSQL docs for **`--clean`** / **`--if-exists`** vs. creating an empty DB first. Copy dumps to **durable off-site** storage; verify **size** and **checksum** on upload.

**Host script (A5 starter):** [`deploy/scripts/pg-backup.sh`](../deploy/scripts/pg-backup.sh) wraps `pg_dump` via `docker compose` (defaults: production compose file + `PGDATABASE=carrental`). For staging, set `COMPOSE_FILE`, `ENV_FILE`, and `PGDATABASE=carrental_staging` as documented in the script header. Run from **Git Bash**, **WSL**, or any POSIX shell — schedule via **cron** / **Task Scheduler** calling the script, then **encrypt** and replicate the `backups/*.dump` files off-host per your policy.

**Scope:** a database backup does **not** include **`STORAGE_MODE=local`** files on disk or **S3** objects — those need [their own backup / lifecycle policy](#object-storage-s3-and-minio). Redis in the sample stack is **ephemeral** (no append-only file); replay traffic or accept reset throttler state — **PostgreSQL** is the system of record.

### Restore drill (minimum)

Do this at least **once per quarter** (or per your compliance policy) against a **non-production** instance:

1. **Restore** the latest good backup into a **new** database or cluster (never overwrite prod first).
2. Point a **throwaway** API (or staging) `DATABASE_URL` at it and run **`GET /v1/health/ready`**.
3. **Smoke:** sign-in, open one reservation, confirm Prisma **`_prisma_migrations`** matches expectations (no accidental `migrate deploy` on an old snapshot unless you know the migration history).
4. Record **actual** time-to-restore and gaps found; update RPO/RTO assumptions.

**Staging:** [STAGING.md](STAGING.md) — a lighter RPO is often acceptable; still run a **restore rehearsal** so the team knows the steps.

## Desk handover, return, and damage (D3, F1, F2)

Desk workflows are under **`/desk/reservations`** (Next) calling the authenticated API **`/v1/reservations/*`** and **`/v1/reservations/:id/ops/*`**.

### Handover gate (D3) — **CONFIRMED** → **`IN_PROGRESS`**

The API blocks **`PATCH …/reservations/:id`** with **`status: "IN_PROGRESS"`** until policy checks pass ([`reservation-handover.util.ts`](../apps/api/src/reservation/reservation-handover.util.ts)). **`GET …/reservations/:id`** always includes **`handoverGate`**: **`ready`**, **`blockerCodes`** (i18n on the desk), **`cargosTransmissionRequired`**, etc.

| API env (API container only) | Default | Meaning |
|------------------------------|---------|---------|
| **`HANDOVER_REQUIRE_SIGNED_AGREEMENT`** | on (`true`) | **`RentalAgreement.status === SIGNED`** |
| **`HANDOVER_REQUIRE_CARGOS`** | on | When **`requireCargos`** and the **company** is in scope with adapter **not OFF**, a **`CargosSubmission`** in **`MOCK_SENT`** or **`SKIPPED`** is required (or an **override** — below). |
| **`HANDOVER_REQUIRE_ID_DOCUMENTS`** | off | Linked **customer** has at least one **completed** ID-style **`CustomerDocument`** (**`DRIVING_LICENSE`**, **`ID_CARD`**, **`PASSPORT`**). |

Align these with **legal / ops** (counsel). Empty env value falls back to the code default.

**CaRGOS alignment (D5):** Per company (**Desk → Organization → CaRGOS**), **`cargosInScope`**, **`cargosAdapter`** (**MOCK** / **HTTP** / **OFF**), and **`cargosHttpUrl`** determine whether transmission is required (**`handoverGate.cargosTransmissionRequired`**). The **worker** processes the queue ([`apps/worker/src/main.ts`](../apps/worker/src/main.ts)); keep it running in production when **HTTP** or **MOCK** is used.

**Auto-enqueue:** When a rental agreement is **signed**, the API can enqueue CaRGOS the same way as **`POST /v1/integrations/cargos/enqueue`** — controlled by **`CARGOS_AUTO_ENQUEUE_ON_SIGN`** (**`0` / false / off** disables; failures are **audit**-logged).

**Handover exception (override):** **`PATCH …/reservations/:id`** with **`cargosHandoverOverride`**: **`null`** (clear) or **`{ "reason": "…" }`** — **`ADMIN`** / **`BRANCH_MANAGER`** only, **audited**. Use only under your **D3 / legal** procedure.

### Handover / return photos and checklists (F1)

- **Photos:** **`GET/POST …/reservations/:id/ops/…`** — list, presigned S3 or multipart local uploads (same **`STORAGE_MODE`** as agreements — [§ Object storage](#object-storage-s3-and-minio)).
- **Checklists / notes:** Reservation **`PATCH`** accepts **`handoverChecklist`**, **`returnChecklist`**, **`handoverOpsNotes`**, **`returnOpsNotes`** (see shared patch schema).

### Damage report (F2)

- **`GET/PUT …/reservations/:id/ops/damage`** — structured lines and notes.
- **Damage photos:** **`…/ops/damage/photos*`** (presign / complete / local upload / download) — same storage semantics as ops photos.
- **Deposit alignment:** Line items may include **estimated fee (cents)** per row; the desk can **sum those estimates** into **suggested capture** and offers shortcuts when **capturing** the Stripe deposit hold (partial capture must stay within the authorized hold). Automated charge-from-damage is not in v1 — staff capture or release in the reservation **Stripe** block.

### Smoke checklist (desk lifecycle)

- [ ] **`HANDOVER_*`** and **`CARGOS_AUTO_ENQUEUE_ON_SIGN`** match your policy in **`deploy/.env`** ([`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) passes them into the **api** service).  
- [ ] **Company CaRGOS** settings + **worker** running; **`MOCK_SENT`** / **`SKIPPED`** / override behaves as expected before handing keys.  
- [ ] **Handover / return** photos and **`COMPLETED`** (and **damage** if used) work with your **`STORAGE_MODE`**.

Real **Questura** / middleware compliance (**D4–D6**) — operational checklist and **`cargosHttpUrl`** wiring: [§ CaRGOS production](#cargos-worker-middleware-and-operations-d4-d5-d6); feature catalog [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md), [ARCHITECTURE.md](../ARCHITECTURE.md).

## GDPR and customer data (B4, B2)

This section describes **what the repo implements** for privacy-related CRM flows. **Policies, notices, legal bases, and DSAR procedures** are for your **DPO / counsel** — align field usage (`privacyNoticeVersion`, marketing opt-in) with lawyer-approved text.

### Consents and CRM fields (B4)

| Mechanism | Detail |
|-----------|--------|
| **Schema** | **`Customer`:** `privacyNoticeVersion`, `privacyNoticeAcceptedAt`, `marketingEmailOptIn`, `marketingOptInAt`, `anonymizedAt` ([`schema.prisma`](../apps/api/prisma/schema.prisma)). |
| **Update** | **`PATCH /v1/customers/:id`** (ADMIN / BRANCH_MANAGER / AGENT) — setting `privacyNoticeVersion` without an explicit `privacyNoticeAcceptedAt` stamps **now**; cannot patch after **`anonymizedAt`**. |
| **Export** | **`GET /v1/customers/:id/gdpr/export`** — JSON package `exportKind: customer_gdpr_v1`: customer snapshot, all linked **reservations** (summary fields), **`CustomerDocument`** metadata (`docType`, names, sizes, **`retentionUntil`**). **No binary file payloads**; use audited document download if your policy requires file copies in a DSAR ([`customer.service.ts`](../apps/api/src/organization/customer/customer.service.ts)). |
| **Anonymize** | **`POST /v1/customers/:id/gdpr/anonymize`** — **ADMIN** / **BRANCH_MANAGER** only; body optional `{ "reason" }` (audit). Clears **PII** on the customer row, clears fiscal/PEC fields and marketing/consent timestamps, sets **`anonymizedAt`**, and **redacts denormalized** `customerName` / `customerEmail` / `customerPhone` on linked **reservations**. **`customer.gdpr_anonymize`** is written to the **audit** log. |
| **Desk** | **`/desk/customers`** — edit form (B4 block), **Export JSON**, **Anonymize** with reason. |

**Operational gap (v1):** **Anonymize does not delete `CustomerDocument` rows or stored blobs.** Identity scans and other uploads remain until someone deletes them via **`DELETE /v1/customers/:id/documents/:docId`** (storage is removed in [`customer-document.service`](../apps/api/src/organization/customer/customer-document.service.ts)), until **`retentionUntil`** passes and the **worker** purges them (B2), or until you use **`DELETE /v1/customers/:id`**. That **customer delete** cascades **`CustomerDocument`** rows in the **database** only — it does **not** run per-document storage deletion, so **S3 / local blobs may be orphaned** unless you delete documents through the document API first or run a separate cleanup. Plan with counsel: for a full erasure request, define an **order of operations** (export evidence → delete each document via API → anonymize or delete customer).

### KYC document retention (B2)

| Item | Detail |
|------|--------|
| **`retentionUntil`** | Optional on **`CustomerDocument`**; when **≤ now**, the **worker** may delete the row and the object (local or S3) in batches ([`purge-retention.ts`](../apps/worker/src/purge-retention.ts)). |
| **Env** | **`WORKER_RETENTION_PURGE_BATCH`** — default **25** per idle tick in compose; **`0`** disables purge. Worker must use the **same** **`STORAGE_MODE`** / **`S3_*`** / **`STORAGE_LOCAL_ROOT`** as the API. |
| **Verification** | In **staging**, set **`retentionUntil`** in the past on a test document, ensure worker logs **`[worker] B2 retention: purged …`** and the object is gone from bucket/disk. |

### Runbook (production)

1. **Privacy notice & marketing** — Publish the real **privacy notice** and **marketing** policy; store **`privacyNoticeVersion`** (e.g. semver or doc id) your counsel approves; train desk staff on **`PATCH`** / desk form.  
2. **DSAR / export** — Define who may call **`gdpr/export`**, SLA, and how you deliver **binary** attachments if required (presigned downloads are **audited** on the document service — see CODEBASE.md / customer documents).  
3. **Erasure** — Document when to **anonymize** vs **delete** customer; if anonymizing, include **deleting KYC documents** (or `retentionUntil` + worker) so storage does not retain identity documents after erasure.  
4. **Retention schedule** — Map **`CustomerDocument.docType`** (and agreements elsewhere) to **legal retention**; set **`retentionUntil`** accordingly; keep **`WORKER_RETENTION_PURGE_BATCH` > 0** in production when you use retention.  
5. **Counsel sign-off** — **B4/B2** in the app does **not** replace registers of processing, DPAs, or Italy-specific filings your lawyer requires. **Rental agreements** and **e-sign** evidence — [§ Legal](#legal-rental-agreements-e-sign-and-counsel-d1-d2).

## Legal: rental agreements, e-sign, and counsel (D1, D2)

v1 stores **contract metadata and sign-time evidence** in **`RentalAgreement`**; it does **not** replace **lawyer-approved PDFs**, **mandatory clauses**, or **eIDAS-qualified** signatures. **Italian counsel** must approve your rental terms, annexes, and how you use this software in production.

### D1 — Template versioning

| Item | Detail |
|------|--------|
| **Field** | **`agreementTemplateVersion`** — optional string (e.g. `ITA-RENT-2026-1`) set when creating or editing a **DRAFT** agreement ([`rental-agreement.service.ts`](../apps/api/src/rental-agreement/rental-agreement.service.ts)). |
| **Desk** | Agreement form on the reservation flow; freeze a **label** your counsel maps to the **authoritative** contract text (PDF, doc registry, or external CMS). |
| **Reporting** | **`GET /v1/reservations`** (list) and desk **CSV** export include **`rentalAgreement.agreementTemplateVersion`** (and **D2** sign fields) for audits. |
| **Ops** | Maintain an **internal register**: template id → document version → effective dates → who approved. When counsel issues a new version, update desk **SOP** so staff pick the new **`agreementTemplateVersion`** value. |

### D2 — E-sign evidence (v1)

On **`POST /v1/.../agreements/:id/sign`** (body includes **`signedByName`**), the API stores:

| Field | Role |
|-------|------|
| **`signedAt`** | Server timestamp when status becomes **`SIGNED`**. |
| **`signedByName`** | Attestation string from the sign request (customer / renter name as entered). |
| **`signedClientIp`** | Client IP from the signing HTTP request — accurate only if **`TRUST_PROXY=true`** and your edge forwards **`X-Forwarded-For`** correctly ([§ API topology](#production-topology-reference)). |
| **`signedUserAgent`** | User-Agent at sign time (stored truncated in Prisma). |

**Not in v1:** separate timestamping authority, OTP to renter email, or **qualified** electronic signature. If your legal standard requires more, add process (face-to-face signing, external QES provider, etc.) and treat these fields as **supporting** audit data only.

**After sign:** optional **CaRGOS** auto-enqueue ([§ Desk handover](#desk-handover-return-and-damage-d3-f1-f2)); agreement **`body`** and **attachments** remain in DB / object storage — [§ Object storage](#object-storage-s3-and-minio).

### Privacy and terms of business

- **Customers (B4)** — privacy notice, marketing opt-in, export/anonymize: [§ GDPR](#gdpr-and-customer-data-b4-b2).  
- **Public site** — publish counsel-approved **privacy policy** and **cookie** approach (not implemented as a CMS module in v1).  
- **Quote / pay** — terms shown on **`/quote`** and payment flows must match what counsel approved for distance contracts / consumer law.

### Smoke checklist (legal readiness)

- [ ] **`agreementTemplateVersion`** values are defined with counsel and used consistently on new agreements.  
- [ ] **`TRUST_PROXY`** and load balancer headers validated so **`signedClientIp`** is trustworthy for your evidence standard.  
- [ ] **Staging** uses **non-production** template ids / dummy text — no accidental reliance on demo **body** in real disputes.

## CaRGOS: worker, middleware, and operations (D4, D5, D6)

This repo does **not** speak to the **Polizia di Stato** portale directly. It persists **`CargosSubmission`** rows and runs a **worker** that, for **`cargosAdapter === 'HTTP'`**, **POST**s JSON to the **`Company.cargosHttpUrl`** you configure in the database (Desk → **Organization → CaRGOS**). **You** operate the **middleware** (or vendor bridge) that maps that payload to **lawful** CaRGOS behaviour after **D6** — enrollment, credentials, PEC, and interpretation with **counsel** / **Questura**.

### D5 — What is stored per company (PostgreSQL, not `.env`)

| Field | Role |
|-------|------|
| **`cargosInScope`** | Whether rentals of this operator are treated as subject to transmission policy. |
| **`cargosEnvironment`** | **`TEST`** vs **`PRODUCTION`** — included in the HTTP JSON for your middleware. |
| **`cargosAdapter`** | **`MOCK`** (simulate success), **`HTTP`** (POST to **`cargosHttpUrl`**), **`OFF`** (no worker send; handover may not require CaRGOS — see **`handoverGate.cargosTransmissionRequired`**). |
| **`cargosHttpUrl`** | HTTPS URL of **your** middleware in production. Must be reachable from the **worker** egress (not from customers’ browsers). |
| **`cargosCutoffMinutesBeforePickup`** | After `pickupAt − N` minutes, **new** CaRGOS enqueue is rejected and **IN_PROGRESS** shows **`CARGOS_ENQUEUE_CUTOFF`** until **ADMIN**/**BRANCH** override (if transmission still required). `null`/`0` disables in software. |
| **`Station.cargosLocationCode`** | Sent as **`station.cargosLocationCode`** (and legacy flat fields) in the payload — must match what your middleware / manuals expect. |

**API-only env** (already in compose): **`CARGOS_AUTO_ENQUEUE_ON_SIGN`**, **`HANDOVER_REQUIRE_CARGOS`** — [§ Desk handover](#desk-handover-return-and-damage-d3-f1-f2).

### D4 — Worker behaviour and environment

The worker reads **`CargosSubmission`** rows and processes **`PENDING`** (and recovers stuck **`PROCESSING`** after **`WORKER_PROCESSING_STALE_MS`**). For **HTTP**, it uses **`fetch`** with **`Content-Type: application/json`**. Any **2xx** response marks the row **`MOCK_SENT`** (name retained from stub days = adapter accepted). Failures increment **`attemptCount`**; after **`CARGOS_MAX_ATTEMPTS`**, status **`FAILED`** — alert and retry manually ([§ Observability — alerts](#alerts-suggested)).

| Worker env | Default | Purpose |
|------------|---------|---------|
| **`CARGOS_MAX_ATTEMPTS`** | `5` | Requeue until exceeded, then **`FAILED`**. |
| **`CARGOS_HTTP_TIMEOUT_MS`** | `30000` | Per-request timeout for **`cargosHttpUrl`**. |
| **`WORKER_POLL_IDLE_MS`** | `2000` | Sleep between idle poll cycles. |
| **`WORKER_PROCESSING_STALE_MS`** | `900000` (15 min) | **`PROCESSING`** rows older than this → **`PENDING`** (crash recovery). Min **60s** in code. |
| **`WORKER_CARGOS_MOCK_DELAY_MS`** | `400` | **MOCK** adapter only — artificial delay before success. |

Pass these through **`deploy/.env`** into the **worker** service ([`docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) / **`.staging.yml`**). **`cargosHttpUrl`** is **not** here — it stays in **`Company`** for multi-tenant and DR swaps via DB/API.

**Concurrency:** Run **one** worker instance per database for predictable CaRGOS processing (startup log says **single instance recommended**).

### Middleware contract (HTTP)

- **Body type:** **`CargosHttpAdapterPayload`** — field list and **`specVersion`** in [`packages/shared/src/cargos-http-payload.ts`](../packages/shared/src/cargos-http-payload.ts) (also published as **`@car-rental/shared`**). Your service should read **`specVersion`** and reject unknown versions.
- **Security (ops):** Use **HTTPS**; place the endpoint on a **private network** or lock it down with **mTLS**, **IP allowlisting** (worker egress), or **application API keys** — v1 worker sends **no** auth headers (add a reverse proxy or extend the worker **only** with your security design).
- **Idempotency:** Payload includes stable **`submissionId`**; if the official channel requires single delivery, dedupe on that id in your layer.

### D6 — Operational checklist (Italy)

Full narrative: [PRODUCTION-READINESS.md § D6 — Operational checklist](PRODUCTION-READINESS.md#d6--operational-checklist-cargos--italy). **Summary:**

1. **Eligibility** — Confirm CaRGOS applies to your product; align **`cargosInScope`**.  
2. **Questura / enrollment** — Legal entity onboarding; obtain **test** vs **production** channels when offered.  
3. **PEC / registers** — Follow current rules; keep an evidence trail (DB rows + your external register).  
4. **Secrets** — Portal / middleware credentials in a **secret manager**, not git.  
5. **Staging** — **`cargosEnvironment`** **TEST** only; no production Polizia credentials on staging ([STAGING.md](STAGING.md)).  
6. **Go-live** — Point **`cargosHttpUrl`** at **production** middleware **only** after counsel + Polizia process sign-off; set **`cargosEnvironment`** **PRODUCTION** on live companies.

### Smoke checklist (CaRGOS)

- [ ] **Desk** company: **MOCK** path — enqueue → **`MOCK_SENT`** → handover (if **`HANDOVER_REQUIRE_CARGOS`**).  
- [ ] **Staging** — **HTTP** to a **non-production** sink; inspect POST body vs **`CargosHttpAdapterPayload`** / **`specVersion`**.  
- [ ] **Worker** logs — no sustained **`[cargos] FAILED`** after credentials are correct; tune **`CARGOS_HTTP_TIMEOUT_MS`** for slow middleware.  
- [ ] **Production** — **HTTPS** **`cargosHttpUrl`**, network path from worker, alerts on **`FAILED`** submissions.

## Invoices and SDI (E3, E4)

v1 implements **desk-facing invoices** and an optional **SDI / FatturaPA handoff** to **your** middleware — **not** a full Agenzia delle Entrate client. **Accountant + counsel** define legal numbering, VAT treatment, XML, and when **`POST /integrations/sdi/enqueue`** is allowed.

### E3 — Invoices, sequences, desk workflow

| Topic | Behaviour |
|-------|-----------|
| **API** | **`GET/POST/PATCH/DELETE /v1/invoices`** (list scoped by company); **`POST /v1/invoices/:id/issue`**; **`POST /v1/invoices/:id/void`**. |
| **Roles** | **`READONLY_ACCOUNTING`** may list/read but **cannot** **issue** or **void** ([`invoice.service.ts`](../apps/api/src/invoice/invoice.service.ts)). |
| **Draft → issued** | Only **`DRAFT`** rows can be **issued**. **Issue** runs in a **`Serializable`** transaction: increments **`InvoiceFiscalSequence`** for **`companyId` + UTC calendar `year`**, sets **`documentNumber`** as **`{year}/{sequence}`** with sequence zero-padded to **5** digits (e.g. `2026/00001`), **`ISSUED`**, **`issuedAt`**. |
| **Year** | Sequence partition uses **`new Date().getUTCFullYear()`** at issue time — confirm with your accountant whether this matches your **fiscal / civil** rules. |
| **Credit notes** | **`kind: CREDIT_NOTE`** requires **`creditedInvoiceId`** pointing to an **`ISSUED`** **`INVOICE`**; still goes through **issue** for its own number. |
| **Void** | **`VOID`** only from **`ISSUED`**; does **not** reuse or rewind sequence numbers — your process must align voiding with Italian rules. |
| **Desk** | **`/desk/invoices`** — drafts, link/clear reservation, **Issue**, **Queue SDI** (E4), void, credit notes; **`GET /v1/invoices/:id`** includes **company** (B3 lessor) and **reservation.customer** for fiscal snapshots. |
| **B3 lessor** | Fill **`Company`** fiscal fields in **Organization** — they flow into SDI JSON as **`supplier`** ([`sdi.service.ts`](../apps/api/src/integrations/sdi/sdi.service.ts)). |

### E4 — SDI adapter (`sdiAdapter`, `sdiHttpUrl`)

Per-**company** fields on **`Company`** (Desk → **Organization → SDI**): **`sdiAdapter`** **`OFF`** | **`MOCK`** | **`HTTP`**; **`sdiHttpUrl`** when **`HTTP`**.

| Adapter | Behaviour |
|---------|-----------|
| **`OFF`** | **`POST /v1/integrations/sdi/enqueue`** with body **`{ invoiceId }`** creates a **`SdiInvoiceSubmission`** in **`SKIPPED`** (no HTTP). |
| **`MOCK`** | Immediate **`MOCK_SENT`** with fake **`idTracciatura`** — UAT only. |
| **`HTTP`** | API **`POST`**s JSON to **`sdiHttpUrl`** **from the request handler** (synchronous for the caller — not the CaRGOS worker). **15s** timeout ([`HTTP_TIMEOUT_MS`](../apps/api/src/integrations/sdi/sdi.service.ts)). **2xx** → **`SENT`**; optional response body JSON **`{ "idTracciatura": "…" }`** stored on the row. Non-2xx / network error → **`FAILED`**, **`errorMessage`** truncated. |
| **Idempotency** | Second **successful** submit (**`MOCK_SENT`** or **`SENT`**) for the same invoice → **409** conflict. |
| **Audit** | **`sdi.submission`** on success-shaped outcomes ([`SdiService`](../apps/api/src/integrations/sdi/sdi.service.ts)). |
| **List** | **`GET /v1/integrations/sdi/submissions?companyId=`** / **`invoiceId=`** (staff-scoped). |

**JSON body to middleware** includes **`submissionId`**, **`invoiceId`**, **`documentNumber`**, amounts, **`supplier`** (lessor B3), **`buyer`** from linked **reservation** + **customer** when present — extend or wrap in your gateway to build **FatturaPA** / SDI.

**Security:** Same pattern as CaRGOS: **HTTPS**, private network or **mTLS** / API keys at a reverse proxy — the API sends **no** auth headers to **`sdiHttpUrl`** in v1.

### Operational checklist

1. **Numbering** — Align **`InvoiceFiscalSequence`** behaviour with your **registro fatture** / counsel (gaps, voids, year rollover).  
2. **Issue before SDI** — Enqueue only **`ISSUED`** documents.  
3. **Staging** — Use **`MOCK`** or **`OFF`**; do **not** point staging at live **SDI** / accountant **production** URLs.  
4. **Monitoring** — Query or alert on **`SdiInvoiceSubmission.status = FAILED`**; investigate **`errorMessage`**.  
5. **Go-live** — Enable **`HTTP`** + production **`sdiHttpUrl`** only when your middleware and **Agenzia** process are approved.

### Smoke checklist (invoices / SDI)

- [ ] **DRAFT** → **Issue** → **`documentNumber`** and **`InvoiceFiscalSequence`** correct for the company/year.  
- [ ] **Credit note** against **ISSUED** invoice issues its own number.  
- [ ] **`sdiAdapter` MOCK** → **Queue SDI** → **`MOCK_SENT`** + audit.  
- [ ] **`HTTP`** to a test middleware → **2xx** → **`SENT`** and optional **`idTracciatura`**; force **4xx** → **`FAILED`**.

## Reconciliation and company reports (E1, G1)

Use these endpoints in **monthly close** and operational review. Dates are **`YYYY-MM-DD`** interpreted as **UTC** day bounds (**`from`** 00:00:00.000Z through **`to`** 23:59:59.999Z). **`ADMIN`**, **`BRANCH_MANAGER`**, **`AGENT`**, and **`READONLY_ACCOUNTING`** may call both ([`payments.controller.ts`](../apps/api/src/payments/payments.controller.ts), [`reports.controller.ts`](../apps/api/src/reports/reports.controller.ts)).

### E1 — Stripe reconciliation export

| Item | Detail |
|------|--------|
| **Route** | **`GET /v1/payments/stripe/reconciliation?companyId=&from=&to=&format=json|csv`** |
| **Row set** | Reservations for **`companyId`** where **`paidAt`** falls in the window **or** **`depositHoldStatus` ≠ `NONE`** and **`updatedAt`** falls in the window ([`getReconciliation`](../apps/api/src/payments/payments.service.ts)). |
| **`matchReason`** | **`RENTAL_PAID_IN_WINDOW`**, **`DEPOSIT_ACTIVITY_IN_WINDOW`**, or **`BOTH`** — which condition matched. |
| **`AGENT`** | Rows limited to reservations whose **pickup** or **return** station is the agent’s **`stationId`**. |
| **CSV** | Download headers appropriate for spreadsheet import; comment lines prefix **`#`**. |
| **`processedStripeEventCount`** | Count of **`ProcessedStripeEvent`** rows with **`createdAt`** in the **same** window — **across the whole DB**, not filtered by **`companyId`** (use as a coarse webhook-activity hint, not per-tenant settlement). |
| **Gaps** | **Refund** and partial-refund identifiers are **not** stored on reservations — match totals to **Stripe Dashboard** / **Balance transactions** for the same period (noted in API **`note`**). |

**Desk:** **`/desk/reconciliation`** — summary (match split, **public** vs **desk** source, anomaly-style flags), filters, **Open in desk** deep links.

### G1 — Company report (revenue, utilization, CaRGOS counts)

| Item | Detail |
|------|--------|
| **Route** | **`GET /v1/reports/company?companyId=&from=&to=`** |
| **Completed revenue** | Sum of **`totalCents`** for **`COMPLETED`** reservations whose **`returnAt`** is in the **inclusive** UTC window (`gte` `from`, `lte` `to`). |
| **Created in range** | Reservations with **`createdAt`** in the window — breakdown by **`source`** and **`status`**. |
| **CaRGOS** | **`CargosSubmission`** rows **`createdAt`** in window, grouped by **`status`**. Response also includes **`cargosDailyCreated`**: **UTC calendar days** in the same **`from`/`to`** range, each with counts **by status** (submissions **created** that day; status is **current** state). **`AGENT`**: CaRGOS rows limited to submissions whose **`Reservation`** has **pickup** or **return** station = agent **`stationId`** (aligned with E1 / utilization). |
| **Utilization** | Overlap of **non-`CANCELLED` / non-`NO_SHOW`** reservations with **[`from`, `to`]** as **half-open** calendar coverage in UTC; **`OUT_OF_FLEET`** vehicles excluded; capacity = (days in range) × vehicle count. Per-class and fleet % capped at **100%** ([`reports.service.ts`](../apps/api/src/reports/reports.service.ts)). **`AGENT`**: vehicles restricted to **`homeStationId`** = branch; overlaps only for reservations in branch scope. |
| **UI copy** | Response includes **`utilization.definitionKey`** — desk i18n **`desk.reports.utilization.definition`** (shared key **`COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY`**). |

**Desk:** **`/desk/reports`** — pick **from** / **to** and company; display revenue, tables, utilization blurb, CaRGOS **daily** grid (UTC).

### Operational checklist

1. **Reconciliation** — Schedule regular **CSV** pulls into accounting; for each period reconcile **rent + deposit** IDs to Stripe; investigate **`matchReason`** splits and rows with **`paidAt` but missing `stripeCheckoutSessionId`** (desk flags).  
2. **Reports** — Before trusting **utilization %**, sanity-check fleet size (**vehicles not `OUT_OF_FLEET`**), date range semantics (**return** vs **created** vs overlap), and branch scope for **AGENT** users.  
3. **Timezone** — API uses **UTC** date bounds; Italy-facing ops may compare with **Europe/Rome** civil days and adjust export windows if needed.  
4. **Access** — Treat JSON/CSV as **financial data**; **`READONLY_ACCOUNTING`** can export but cannot issue invoices ([§ Invoices and SDI](#invoices-and-sdi-e3-e4)).

### Smoke checklist (E1 / G1)

- [ ] **Reconciliation** JSON/CSV for a week with known **Stripe** checkouts matches **`paidAt`** / deposit fields.  
- [ ] **`AGENT`** export only sees branch-scoped reservations.  
- [ ] **Company report** revenue matches a hand-check of **`COMPLETED`** rows in **`returnAt`** window.  
- [ ] **Utilization** moves in the right direction when adding/removing overlapping bookings in the range.

## Partner API and document OCR (G2, G3)

**Partially implemented in repo (v1).** Staff JWT **`/v1/*`** and public **`/v1/public/*`** remain the primary surfaces. The backlog items below describe **production-grade** partner identity and **managed** OCR vendors; this codebase includes a **partner API key** module, **idempotent partner creates**, **partner throttles**, a **mock OCR** pipeline, and an optional **HTTP OCR adapter** hook with the same staff apply/dismiss pattern.

### G2 — Partner / B2B API (in repo — mock-friendly)

**Implemented (scaffold):** Prisma **`PartnerApiKey`** (hashed secret, scoped to **`Company`**); optional per-key **HTTPS webhook** URL + **HMAC-SHA256** signing secret (desk Organization → **Webhook** on each key); after each **new** `POST /v1/partner/reservations` (not idempotent replays), the API enqueues **`PartnerWebhookDelivery`** (`reservation.created` JSON body persisted for a stable HMAC input); after an allowed partner **`PATCH /v1/partner/reservations/:id`** cancel, it enqueues **`reservation.cancelled`** (payload includes **`previousStatus`**). When **`Reservation.createdByPartnerApiKeyId`** is set (partner creates after migration **`20260516120000_reservation_created_by_partner_key_g2`**; **legacy** **`PARTNER`** rows are backfilled from **`PartnerReservationIdempotency`** by migration **`20260519120000_backfill_reservation_created_by_partner_key_g2`** — reservations without an idempotency row stay null), a **staff** **`PATCH /v1/reservations/:id`** or **Stripe** rental checkout completion that **changes** **`status`** enqueues **`reservation.status_changed`** (payload includes **`previousStatus`**) for that key. Delivery runs from **`POST /v1/internal/cron/partner-webhook-deliveries`** (Bearer **`WORKER_INTERNAL_SECRET`**, same as other internal crons): bounded batch, exponential backoff, **`DEAD`** after **`PARTNER_WEBHOOK_MAX_ATTEMPTS`** (per-row **`maxAttempts`** captured at enqueue). Rows stay **`PENDING`**/**`PROCESSING`** until **`SUCCEEDED`** or **`DEAD`**; stuck **`PROCESSING`** is reclaimed after **`PARTNER_WEBHOOK_STALE_MS`**. Each attempt **POST**s with **`X-Partner-Event`** matching the row (`reservation.created`, `reservation.cancelled`, …) and **`X-Partner-Signature: sha256=<hex>`** over the stored **`bodyJson`** using the key’s **current** secret (rotation applies to the next attempt). Staff **`PATCH /v1/companies/:companyId/partner-api-keys/:keyId/webhook`** updates or clears URL/secret. Revoked or misconfigured keys mark queued rows **`DEAD`** with an error. Reservations may use **`ReservationSource.PARTNER`**; **`GET /v1/partner/me`** returns non-secret key context (**`webhookDeliveryEnabled`** mirrors the enqueue gate); **`POST /v1/partner/reservations`** (create), **`PATCH /v1/partner/reservations/:id`** (cancel-only body **`{ "status": "CANCELLED" }`**), **`GET /v1/partner/reservations`** (paginated list, optional `status`, `limit`/`offset`) and **`GET /v1/partner/reservations/:id`** with **`Authorization: Bearer crtp_…`** or OAuth access token or **`X-Partner-Key`**; desk **Organization** — partner API keys UI; Swagger **Partner** tag + **`partner-bearer`** / **`X-Partner-Key`** schemes; **`Idempotency-Key`** header on partner **`POST`** create — same key + same body returns the existing reservation; same key + different body → **409**; persistence in **`PartnerReservationIdempotency`**; **`@Throttle`** on partner reservation routes (align **`REDIS_URL`** for shared counters across replicas). Optional env **`PARTNER_API_ALLOWED_IP_CIDRS`** and optional per-key allowlist (**`PATCH /v1/companies/:companyId/partner-api-keys/:keyId/allowed-ip-cidrs`**, desk Organization under the **Webhook** editor): comma-separated **IPv4** addresses and/or **`a.b.c.d/nn`** CIDRs — when **both** env and per-key lists are non-empty, **both** must match (**AND**); when only one is set, that list applies; the **`PartnerKeyGuard`** rejects other client IPs (**403**); requires correct **`TRUST_PROXY`** and **`req.ip`** behind your edge. **`GET /v1/health/summary`** includes **`queues.partnerWebhookPending`**. **Worker** (`apps/worker`): optional **`WORKER_PARTNER_WEBHOOK_INTERVAL_MS`** (default **0** = off; e.g. **60000**) calls **`POST …/internal/cron/partner-webhook-deliveries`. **OAuth2 (client credentials):** desk **`POST …/partner-api-keys/:keyId/oauth-client-secret`** stores a bcrypt **`oauthClientSecretHash`**; partners call **`POST /v1/partner/oauth/token`** with JSON **`{ grant_type, client_id, client_secret }`** and receive **`access_token`** (JWT signed with **`PARTNER_OAUTH_JWT_SECRET`**, or **`JWT_SECRET`** in dev when unset) — use **`Authorization: Bearer &lt;access_token&gt;`** on **`/v1/partner/*`** alongside legacy **`crtp_…`**. **mTLS:** optional **`PARTNER_MTLS_REQUIRE`**; the API checks a header your reverse proxy sets when **`ssl_client_verify`** (or equivalent) succeeds (defaults **`X-Client-Cert-Verified: SUCCESS`**). Counsel / DPIA and published SLA for regulated B2B are still your responsibility.

For **OTAs**, **brokers**, or **corporate** programmes that must book into your fleet:

1. **Identity** — Prefer **OAuth 2.0** client credentials or **mTLS** with short-lived tokens; avoid decade-long shared secrets in partner code; rotate credentials (**PRODUCTION-READINESS** **A4** + desk dashboard runbook). **In repo:** OAuth2 **`POST /v1/partner/oauth/token`** + optional edge **mTLS** header gate (**`PARTNER_MTLS_*`**); legacy **`crtp_…`** keys remain for backward compatibility.
2. **Tenancy** — Every read/write is **company-scoped**; enforce the same **availability** and **pricing** rules the desk uses so you do not double-sell vehicles.
3. **Contracts** — Publish versioned schemas or OpenAPI; **`Idempotency-Key`** on **POST** creates is supported in-repo; document **rate limits** (per-route throttles + optional **`REDIS_URL`** throttler for replicas).
4. **Lifecycle** — Decide whether partners create **`Reservation`** rows (identical lifecycle to **STAFF**/**PUBLIC_WEB**) or a separate staging model you merge; **handover**, **CaRGOS**, and **SDI** obligations remain with the **operating** company.
5. **Outbound** — If you **webhook** partners (confirm, cancel, modify), **sign** payloads (e.g. **HMAC**), **retry** with backoff, and persist **delivery / audit** rows.

**Desk:** **Organization** — partner API keys + **webhook delivery log** ( **`READONLY_ACCOUNTING`**: view-only for keys, webhooks, and deliveries on own company ); collapsible **G2 / G3** runbook (EN/IT).

### G3 — Document OCR (in repo — mock / HTTP adapter + queue)

**Implemented (v1 demo + adapter hook):** **`CustomerDocumentOcrStatus`** (**NONE**, **PENDING**, **READY**, **FAILED**); desk **Customer documents** — **Run demo OCR**, suggestion panel, **apply** selected fields / **dismiss**; OCR never writes **`Customer`** until staff applies. Optional **`CUSTOMER_DOCUMENT_OCR_AUTO`**: **`mock`** or **`http`**. After upload completes, doc is **`PENDING`**; **`POST /v1/internal/cron/customer-document-ocr`** (Bearer **`WORKER_INTERNAL_SECRET`**, same as other internal crons) runs a batch (**`CUSTOMER_DOCUMENT_OCR_CRON_BATCH`**). For **async** vendor jobs, your adapter can instead call **`POST /v1/internal/cron/customer-document-ocr-callback`** with the same Bearer and JSON **`{ documentId, suggestion }`** (Zod suggestion shape) or **`{ documentId, error }`** (failure message) while the document is still **`PENDING`** and not staff-applied. **`mock`** fills the same deterministic **MOCK** suggestion as the desk button. **`http`** **POST**s JSON to **`CUSTOMER_DOCUMENT_OCR_HTTP_URL`** (optional **`CUSTOMER_DOCUMENT_OCR_HTTP_SECRET`** Bearer, **`CUSTOMER_DOCUMENT_OCR_HTTP_TIMEOUT_MS`**, **`CUSTOMER_DOCUMENT_OCR_HTTP_VENDOR`** label); when **`STORAGE_MODE=s3`** and **`CUSTOMER_DOCUMENT_OCR_HTTP_INCLUDE_PRESIGNED_GET`** is truthy, the JSON may include **`documentDownloadUrl`** (short-lived **GET** presigned URL, TTL **`CUSTOMER_DOCUMENT_OCR_HTTP_PRESIGN_GET_SECONDS`**). Optional **`CUSTOMER_DOCUMENT_OCR_HTTP_HMAC_SECRET`**: request headers **`X-CarRental-Ocr-Timestamp`** (unix seconds) and **`X-CarRental-Ocr-Signature`** (**hex** **HMAC-SHA256** over **`timestamp + "." + body`** UTF-8) so your adapter can verify origin without relying on the Bearer alone. Response must be the suggestion object or **`{ "suggestion": { … } }`**, matching the shared Zod suggestion schema. **`GET /v1/health/summary`** exposes **`queues.customerDocumentOcrPending`**. **Worker** (`apps/worker`): optional **`WORKER_CUSTOMER_DOCUMENT_OCR_INTERVAL_MS`** (default **0** = do not call; e.g. **900000** when API auto-queue is on and the worker should tick the cron).

Applies to **licence**, **ID card**, and **passport** scans (see desk **Customer documents** for storage).

1. **Async pipeline** — Ingest upload → **queue** → vendor **OCR** → store **suggested** values **separately** from committed **`Customer`** / **`CustomerDocument`** fields until staff confirms. **Repo:** **`PENDING`** → cron (**`customer-document-ocr`**) → **`READY`** suggestion JSON (**mock** or **HTTP** adapter), or your worker pushes **`customer-document-ocr-callback`** when the vendor finishes later.
2. **Human confirmation** — Require explicit **review** for **fiscal identifiers**, **licence numbers**, and **expiry**; counsel may allow auto-fill for low-risk fields only.
3. **Privacy** — OCR vendor is a **subprocessor**: **DPA**, **retention**, region (EU vs third country), alignment with **B2 / B4** and **[§ GDPR & customer data](#gdpr-and-customer-data-b4-b2)** (**`CustomerDocument`** retention). **Repo mock:** no external vendor. **Repo HTTP:** your adapter is responsible for subprocess or **you** run it in-region.
4. **Audit** — Log who **accepted**, **edited**, or **rejected** machine suggestions for regulator and dispute traceability. **Repo:** **`customer_document.ocr_*`** audit actions; cron uses **`customer_document.ocr_cron_mock`** or **`customer_document.ocr_cron_http`** with null user; async callback uses **`customer_document.ocr_async_callback`**.

### Smoke checklist (G2 / G3 in repo)

- [ ] **`GET /v1/partner/me`** returns **`companyId`**, key **`name`**, **`apiVersion`** (same as global REST **`v1`** prefix), and **`webhookDeliveryEnabled`** consistent with desk webhook configuration.
- [ ] Partner **`GET /v1/partner/reservations`** returns only **`PARTNER`**-sourced rows for the key’s company; **`status`** filter matches staff enums; pagination works with **`limit`** / **`offset`**.
- [ ] When **`PARTNER_API_ALLOWED_IP_CIDRS`** and/or **per-key `allowed-ip-cidrs`** are set, requests from non-allowlisted IPv4 addresses receive **403**; when **both** are set, the client must match **both**; **`TRUST_PROXY`** yields the expected **`req.ip`** at your edge.
- [ ] **`POST …/internal/cron/customer-document-ocr-callback`** with a valid **`PENDING`** **`documentId`** stores **`READY`** or **`FAILED`** as intended (Bearer **`WORKER_INTERNAL_SECRET`**).
- [ ] Partner **create** path respects **availability** and cannot bypass **handover** rules silently.
- [ ] Partner **`POST`** is **idempotent** when clients send **`Idempotency-Key`**; conflicting reuse returns **409**.
- [ ] **`POST /v1/partner/oauth/token`** with desk-issued **`client_id`** / **`client_secret`** returns **`access_token`**; **`GET /v1/partner/reservations`** accepts that Bearer token; legacy **`crtp_…`** still works when OAuth is not used.
- [ ] When **`PARTNER_MTLS_REQUIRE`** is set, requests without the expected verification header receive **403**; your edge sets the header after successful client cert verification.
- [ ] Partner **`PATCH /v1/partner/reservations/:id`** with **`{ "status": "CANCELLED" }`** cancels an eligible **PARTNER** row (**409** if paid or deposit hold active); **`reservation.cancelled`** is enqueued when webhooks are configured; idempotent **CANCELLED** returns the reservation.
- [ ] With webhook URL + signing secret set on the key (**desk** or **`PATCH …/webhook`**), a **new** partner create enqueues **`reservation.created`** and an allowed partner cancel enqueues **`reservation.cancelled`**; **`POST …/internal/cron/partner-webhook-deliveries`** (or the worker interval) performs the **HTTPS POST** with **`X-Partner-Signature: sha256=…`**; **idempotent** replays of the same create do **not** enqueue again.
- [ ] **`prisma migrate deploy`** applies **`20260519120000_backfill_reservation_created_by_partner_key_g2`** after the **`createdByPartnerApiKeyId`** column migration; legacy **PARTNER** bookings that had **`Idempotency-Key`** now show **Partner key** on the desk list and receive **`reservation.status_changed`** when appropriate.
- [ ] For a **PARTNER** reservation with **`createdByPartnerApiKeyId`** set (new creates or backfill), a **staff** **`PATCH /v1/reservations/:id`** that changes **`status`** enqueues **`reservation.status_changed`**; paying rent via **Stripe** Checkout when that flips **`QUOTE`/`PENDING_PAYMENT` → `CONFIRMED`** does the same.
- [ ] Desk **Organization** shows **webhook deliveries** (filter + pagination); **`READONLY_ACCOUNTING`** can **GET** partner keys + deliveries for their company but cannot create/revoke/webhook.
- [ ] OCR **suggestions** never overwrite production **customer** or **document** fields without a deliberate **staff** action (apply endpoint).
- [ ] With **`CUSTOMER_DOCUMENT_OCR_AUTO=mock`** or **`http`** (and HTTP URL when **`http`**), upload → **`PENDING`** → cron → **`READY`** or **`FAILED`**; health summary **`customerDocumentOcrPending`** matches DB expectation; **`partnerWebhookPending`** reflects undelivered partner webhooks when G2 hooks are enabled.
- [ ] With **`http`**, **`STORAGE_MODE=s3`**, and **`CUSTOMER_DOCUMENT_OCR_HTTP_INCLUDE_PRESIGNED_GET`**, the OCR POST includes a usable **`documentDownloadUrl`** until expiry; with **`CUSTOMER_DOCUMENT_OCR_HTTP_HMAC_SECRET`**, your adapter can verify **`X-CarRental-Ocr-Signature`** against the raw body + timestamp.

## Observability

### Health endpoints (API)

All routes are under the **`/v1`** global prefix and **`@Public()`** (no JWT). They are **not** subject to the global HTTP throttler (`@SkipThrottle()`).

| Route | Use |
|-------|-----|
| `GET /v1/health` | **Liveness** — process up, no DB (cheap for load balancers). |
| `GET /v1/health/ready` | **Readiness** — **`SELECT 1`** against PostgreSQL; **`503`** if the DB is down (Kubernetes readiness, rolling deploys). |
| `GET /v1/health/summary` | **Single blackbox check** — JSON with `apiVersion`, `uptimeSec`, `node`/`nodeEnv`, **`redis`** (`configured` / `not_configured` from **`REDIS_URL`**), **`queues`** (`cargosInflight`, `sdiInflight` = integration rows in **PENDING** or **PROCESSING**; **`customerDocumentOcrPending`** = **`CustomerDocument`** with **`ocrStatus=PENDING`**, upload complete, not applied — G3; **`partnerWebhookPending`** = **`PartnerWebhookDelivery`** in **PENDING** or **PROCESSING** — G2), DB up; **`503`** if PostgreSQL is unreachable (e.g. Uptime Kuma / Statuspage). |
| `GET /v1/metrics` | **Prometheus text exposition (A6)** — process / Node default metrics (**`prom-client`**) + **`car_rental_http_responses_total`** / **`car_rental_http_responses_5xx_total`** (skips **`/v1/health*`** and **`/v1/metrics`**) + gauges matching **`/health/summary`** queue depths. **No JWT.** Do not expose to the public internet without an **allowlist** at the proxy ([§ Edge / WAF (A7)](#edge--waf-a7)). |

**Docker Compose:** [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) and [`deploy/docker-compose.staging.yml`](../deploy/docker-compose.staging.yml) define an **`api` healthcheck** that probes **`/v1/health/ready`** via Node’s built-in `fetch`.

Use **`ready`** (or **`summary`**) for **traffic gates**; use **`health`** only when you need a minimal process ping without touching the DB.

### Edge / WAF (A7)

If **`https://api…/v1`** is reachable from the **public internet** (not only staff VPN), terminate TLS and apply **rate**, **bot**, and **geo** policies **outside** the Node process:

- **Managed WAF / CDN** — Cloudflare, AWS CloudFront + WAF, Fastly, Google Cloud Armor, etc. — tuned for JSON APIs (payload size, anomalous paths, abuse on **`/v1/auth/*`**).
- **Reverse proxy** — Example **nginx** fragments (TLS, coarse rate limits, **`/v1/metrics`** IP restriction): [`deploy/nginx/api-edge.example.conf`](../deploy/nginx/api-edge.example.conf). Complements [**`REDIS_URL`**](#docker) (Nest throttler) and **`TRUST_PROXY`** ([§ Production topology](#production-topology-reference)) for correct client IP.
- **Partner / webhooks** — **`/v1/partner/*`**, **`/v1/payments/stripe/webhook`**, and **`/v1/integrations/sdi/callback`** may need **higher** limits or **signature-based** rules so a blanket WAF does not block Stripe or SDI middleware.

### Logs

- **API:** Nest logs to **stdout**; in production the default log levels are **error**, **warn**, **log** ([`main.ts`](../apps/api/src/main.ts)). Ship container logs to your platform (**CloudWatch**, **Google Cloud Logging**, **Datadog**, **Loki**, etc.) — avoid writing secrets into log lines.
- **Worker:** **`console.log` / `console.warn`** for CaRGOS, B2 retention, and optional internal API crons (C2 rent reminders, F3 service-due blocks, G3 customer-document OCR when **`WORKER_*_INTERVAL_MS`** is set, G2 **`WORKER_PARTNER_WEBHOOK_INTERVAL_MS`**). Terminal CaRGOS failures emit **`[cargos] FAILED submissionId=… reservationId=… error="…"`** for log-based alerts or metric extraction.

### Worker liveness (no HTTP port)

The worker is a **loop**, not an HTTP server. Rely on:

- **Container restart policy** (`unless-stopped` / Kubernetes restart),
- Optional **`WORKER_HEARTBEAT_LOG_MS`** (e.g. **300000** = 5 minutes) — **`[worker] heartbeat`** on idle cycles ([`apps/worker/src/main.ts`](../apps/worker/src/main.ts)); default **0** keeps logs quiet,
- **Shutdown line:** **`[worker] Stopped. (CaRGOS … FAILED: …)`** on SIGTERM/SIGINT.

### Alerts (suggested)

| Signal | Idea |
|--------|------|
| **HTTP 5xx** | Load balancer or ingress metric — alert on error rate / latency SLO. |
| **Prometheus (A6)** | Scrape **`GET /v1/metrics`** from inside the VPC; alert on scrape failures, rising **`car_rental_http_responses_5xx_total`**, or sustained high **`car_rental_integration_queue_*`** gauges vs. baseline. |
| **API DB** | **`503`** on **`/v1/health/ready`** or **`/v1/health/summary`** — PostgreSQL or network failure. |
| **Redis (A6)** | If **`REDIS_URL`** is set, monitor Redis availability; rate-limit storage uses **`ioredis`** and throttled requests may fail when Redis is unreachable. |
| **Worker process** | Orchestrator “restarts too often”; missing **`[worker] heartbeat`** for longer than **2 × WORKER_HEARTBEAT_LOG_MS** when that env is set; **`[worker] Database unreachable`** on boot. |
| **CaRGOS FAILED** | Log filter **`[cargos] FAILED`**; or scheduled query on **`CargosSubmission`** where **`status = 'FAILED'`** (and **`processedAt`** recent) — drive escalation per [§ CaRGOS production](#cargos-worker-middleware-and-operations-d4-d5-d6). |
| **SDI FAILED** | Query **`SdiInvoiceSubmission`** where **`status = 'FAILED'`** (recent **`processedAt`**); or monitor API logs around desk **Queue SDI** — escalation with accountant/middleware vendor ([§ Invoices and SDI](#invoices-and-sdi-e3-e4)). |
| **Stripe async payment** | Log filter **`Stripe async_payment_failed`** from the API ([`PaymentsService`](../apps/api/src/payments/payments.service.ts)); ensure webhook delivers **`checkout.session.async_payment_failed`** if you enable delayed payment methods. |

### JSON log shape (optional)

If your collector expects **JSON**, wrap the Node process with a structured logger sidecar or use your cloud’s “plain text → JSON” parsers; this repo does not ship a custom Winston/Pino JSON formatter in v1.

## Docker

From the **repository root**:

```bash
docker build -f deploy/Dockerfile.api -t car-rental-api .
docker build -f deploy/Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/v1 \
  --build-arg NEXT_PUBLIC_VAT_RATE=0.22 \
  -t car-rental-web .
docker build -f deploy/Dockerfile.worker -t car-rental-worker .
```

(`NEXT_PUBLIC_*` for the web image must match your public API URL; they are fixed at build time.)

Example compose (adjust secrets and hostnames): [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml). Copy [`deploy/.env.prod.example`](../deploy/.env.prod.example) to `deploy/.env` (or pass `--env-file`) with at least `POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, and `NEXT_PUBLIC_API_URL` (passed as a **build arg** for the web image, not only at container runtime). Optional: `NEXT_PUBLIC_VAT_RATE` for quote VAT display (baked into the web image).

`deploy/docker-compose.prod.yml` runs **postgres**, **redis** (A6), **api**, **web**, and **worker** (CaRGOS queue + B2 retention purge). The API defaults **`REDIS_URL=redis://redis:6379`** so HTTP rate limits use **shared** storage when you scale replicas; override with your managed Redis URL in `deploy/.env` if needed. The worker uses the **same** `DATABASE_URL` and **shared** `car_rental_prod_uploads` volume as the API when `STORAGE_MODE=local` so document blobs stay consistent. With **`STORAGE_MODE=s3`**, use the **same** `S3_*` (and mode) on API and worker — no shared upload volume required ([§ Object storage](#object-storage-s3-and-minio)). Set `WORKER_RETENTION_PURGE_BATCH` (default **25** in compose; **0** disables purge). Set **`WORKER_HEARTBEAT_LOG_MS`** (e.g. **300000**) when you want periodic **`[worker] heartbeat`** lines for log-based checks; default **0** in compose. **CaRGOS worker tuning** — **`CARGOS_MAX_ATTEMPTS`**, **`CARGOS_HTTP_TIMEOUT_MS`**, **`WORKER_POLL_IDLE_MS`**, **`WORKER_PROCESSING_STALE_MS`**, **`WORKER_CARGOS_MOCK_DELAY_MS`** — is passed from the same **`deploy/.env`** into the **worker** service; defaults match [`apps/worker/src/main.ts`](../apps/worker/src/main.ts) ([§ CaRGOS production](#cargos-worker-middleware-and-operations-d4-d5-d6)). Outside Compose, run a worker container or `node apps/worker/dist/main.js` with the same `DATABASE_URL` and storage variables as the API ([`Dockerfile.worker`](../deploy/Dockerfile.worker)). On idle ticks it purges expired **`CustomerDocument`** rows; the process stops within **~200ms** of SIGTERM after an idle poll.

## Security checklist (not exhaustive)

- [ ] Strong `JWT_SECRET`, rotated on compromise
- [ ] HTTPS everywhere; HSTS at load balancer
- [ ] `CORS_ORIGINS` only your real web origins
- [ ] **OpenAPI (`/docs`, `/docs-json` — H1):** disabled by default in **`NODE_ENV=production`**; if you set **`SWAGGER_ENABLE=1`**, do not expose it publicly (VPN, private network, or an authenticated reverse proxy)
- [ ] **A2 — Login lockout:** set **`AUTH_LOGIN_MAX_ATTEMPTS`** and **`AUTH_LOGIN_LOCKOUT_MINUTES`** (compose defaults **8** / **15**); failed **MFA step** codes count the same as bad passwords ([§ Authentication hardening](#authentication-hardening-a2-a3-h1))
- [ ] **A3 — MFA:** enroll **TOTP** for every **`ADMIN`** / **`BRANCH_MANAGER`**; enable **`AUTH_MFA_REQUIRED=true`** after onboarding; disables are blocked while policy is on ([§ Authentication hardening](#authentication-hardening-a2-a3-h1))
- [ ] `TRUST_PROXY` when behind a proxy; ensure proxies strip/forwards client IP safely
- [ ] Stripe: use live keys only in live env; restrict webhook to Stripe IPs if possible
- [ ] **`REDIS_URL`** for **multi-instance** API rate limiting (A6 — `@nestjs/throttler` uses Redis); otherwise single-instance **in-memory** limits still apply — or front the API with a **WAF** / gateway limits ([§ Edge / WAF (A7)](#edge--waf-a7))
- [ ] **A7 — Public API:** WAF / CDN + TLS in front of **`/v1`** when not VPN-only ([§ Edge / WAF (A7)](#edge--waf-a7); example nginx: [`deploy/nginx/api-edge.example.conf`](../deploy/nginx/api-edge.example.conf))
- [ ] **PostgreSQL:** backups + **restore drill** documented; RPO/RTO agreed ([§ PostgreSQL backups](#postgresql-backups-and-restore-rpo--rto)); **S3 / local uploads** backed up if you store blobs outside the DB
- [ ] Secrets in a manager (K8s secrets, SSM, etc.), not in git
- [ ] Log aggregation and alerts on 5xx and DB failures ([§ Observability](#observability))
- [ ] **SMTP** (if used): provider credentials in a secret manager; **`APP_PUBLIC_BASE_URL`** points at the real Next site ([§ Email](#email-transactional))
- [ ] **S3** (if `STORAGE_MODE=s3`): dedicated IAM user/keys; bucket **not** public; **CORS** allows your **`CORS_ORIGINS`** for `PUT` ([§ Object storage](#object-storage-s3-and-minio)); worker uses the same credentials
- [ ] **Desk handover / return / damage:** **`HANDOVER_*`**, **`CARGOS_AUTO_ENQUEUE_ON_SIGN`**, CaRGOS **worker**, and ops storage match policy ([§ Desk handover](#desk-handover-return-and-damage-d3-f1-f2)).
- [ ] **GDPR / CRM (B4, B2):** privacy notice + marketing policy aligned with **`Customer`** fields; DSAR/erasure **runbook** including KYC blobs + **`WORKER_RETENTION_PURGE_BATCH`** ([§ GDPR](#gdpr-and-customer-data-b4-b2)).
- [ ] **CaRGOS (D4–D6):** production **`cargosHttpUrl`** reachable from **worker** egress; **HTTPS** + network/auth on middleware; **D6** done before live Polizia traffic; staging stays **TEST** ([§ CaRGOS](#cargos-worker-middleware-and-operations-d4-d5-d6)).
- [ ] **Invoices / SDI (E3, E4):** fiscal sequence + issue/void rules signed off with accountant; **`sdiHttpUrl`** secured; staging uses **MOCK** or **OFF** only ([§ Invoices and SDI](#invoices-and-sdi-e3-e4)).
- [ ] **Reconciliation / reports (E1, G1):** accountants know Stripe vs DB limits (**refunds**, **`processedStripeEventCount`**); report windows understood in **UTC** ([§ Reconciliation and reports](#reconciliation-and-company-reports-e1-g1)).
- [ ] **Legal — agreements & privacy:** counsel-approved **`agreementTemplateVersion`** register + e-sign evidence baseline (**D1/D2**); privacy / GDPR **B4** aligned ([§ Legal](#legal-rental-agreements-e-sign-and-counsel-d1-d2)) · ([§ GDPR](#gdpr-and-customer-data-b4-b2)).
- [ ] **Pre-launch QA:** minimum smoke + rollback plan rehearsed ([§ Pre-launch QA and rollback](#pre-launch-qa-and-rollback)).
- [ ] **Other compliance:** CaRGOS, fiscal/SDI, consumer terms on the public site — **not** fully specified by this repo; see [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

## Pre-launch QA and rollback

Run the checks below on **staging** first ([STAGING.md](STAGING.md)), then repeat on **production** with **live** Stripe / URLs only when appropriate. Deeper per-area smoke lists are linked throughout **PRODUCTION.md** (Stripe, handover, invoices, etc.).

### Minimum smoke checklist

| Area | What to verify |
|------|----------------|
| **Health** | **`GET /v1/health/ready`** (and optionally **`/v1/health/summary`**) — **200** with DB up ([§ Observability](#observability)). |
| **Auth** | Desk sign-in; **`POST /auth/mfa/complete`** if **A3** policy is on; confirm **`AUTH_MFA_REQUIRED`** rollout does not lock out privileged users ([§ Authentication hardening](#authentication-hardening-a2-a3-h1)). |
| **Desk — reservations** | Create/list reservation; **`PATCH`** lifecycle you use in prod (**`CONFIRMED`**, agreement **DRAFT** → **sign** if handover requires **SIGNED**; **`IN_PROGRESS`** only when **`handoverGate.ready`** or override per policy — [§ Desk handover](#desk-handover-return-and-damage-d3-f1-f2)). |
| **Public `/quote`** | Catalog + estimate → save **QUOTE** → pay (Stripe **test** on staging, **live** only in prod when ready); **`/booking/view?token=…`** — [§ Stripe](#stripe-payments). |
| **Stripe webhooks** | **`checkout.session.completed`** (and async success/failure if you use those methods) reach **`POST /v1/payments/stripe/webhook`**; **`paidAt`** / deposit state update; **Dashboard** or **`stripe listen`** matches app logs. |
| **Worker** | If **CaRGOS** or **B2** retention matters: container up; logs show poll loop; no unexplained **`[cargos] FAILED`** — [§ CaRGOS production](#cargos-worker-middleware-and-operations-d4-d5-d6), [§ GDPR — B2](#kyc-document-retention-b2). |
| **Optional slices** | Reconciliation CSV (**§ E1**), company report (**G1**), invoice issue (**E3**), SDI enqueue (**E4**), GDPR export — only if you use those workflows on day one. |

### Rollback (application)

1. **Images** — Redeploy the **previous known-good** **API**, **web**, and **worker** container images (tags/digests recorded in your release notes). **Web** `NEXT_PUBLIC_*` is **build-time**: a rollback of the web app usually requires the **image** built for that release, not only an API rollback.  
2. **Migrations** — If a bad release ran **new** Prisma migrations, **rolling back the containers alone may not be enough**: either ship a **forward fix** migration, or restore PostgreSQL from backup to a point **before** the migration ([§ PostgreSQL backups](#postgresql-backups-and-restore-rpo--rto)). Do **not** run **`migrate dev`** or ad-hoc `db push` against production.  
3. **Stripe** — Webhook URL and signing secret stay tied to the **same** Stripe mode (**live** vs **test**); **`ProcessedStripeEvent`** keeps webhooks idempotent — old API builds should still **200** on duplicate events.  
4. **Redis (A6)** — Throttler keys are ephemeral; rollback rarely needs Redis flush. If Redis is **down**, API may error on throttled routes until Redis is back — [§ Observability — Alerts](#alerts-suggested).  
5. **Config** — **`HANDOVER_*`**, **`CARGOS_AUTO_ENQUEUE_ON_SIGN`**, **`SWAGGER_ENABLE`**, etc. can be reverted via env + container restart without a schema change when you only need to **disable** behaviour.  
6. **Communication** — Document **who** approves rollback, **who** notifies support/staff, and **when** you restore DB vs hotfix forward.

## CI

GitHub Actions workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `npm install`, **`npm run build -w @car-rental/shared`** (and builds `api`, `web`, `worker`), then **`npm run lint`**. Root script `npm run lint` always rebuilds shared first so local runs match type consumers (`@car-rental/api` reads `packages/shared/dist`).

**After merge to `main`:** run **`prisma migrate deploy`** against the target database (staging or production) in your pipeline **before** or **together with** rolling new API containers — never `migrate dev` on shared prod/staging DBs. See [Database migrations](#database-migrations) above.

## Support matrix

- **Node.js** 20+ (see root `package.json` `engines`)
- **PostgreSQL** 15+ (16 in sample compose)

## Further reading

- [CODEBASE.md](CODEBASE.md) — feature map and routes  
- [TECH_STACK.md](TECH_STACK.md) — technology choices  
- [ARCHITECTURE.md](../ARCHITECTURE.md) — long-term product and domain scope (not all implemented in this repo)  
- [Pre-launch QA and rollback](#pre-launch-qa-and-rollback) — smoke checklist and deploy rollback (this document)
