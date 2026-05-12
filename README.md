# Car rental (Italy) — monorepo

Implements the **first implementation steps** of [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/TECH_STACK.md](docs/TECH_STACK.md): pnpm or npm workspaces, Turborepo, NestJS API with **Company** / **Station** CRUD, **Prisma** + PostgreSQL, **@car-rental/shared** (Zod + constants), a minimal **Next.js** web app, and a **worker** process for the CaRGOS DB poller (optional **BullMQ** later if you add a real job queue).

**Main structures (monorepo layout, API modules, data spine, web routes):** [docs/STRUCTURE.md](docs/STRUCTURE.md) · generated feature + route inventory: [docs/CODEBASE.md](docs/CODEBASE.md).

**What to build for a full production system (gaps vs this scaffold, one-by-one order):** [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md). **Staging stack** (A1: isolated DB, test Stripe, compose file): [docs/STAGING.md](docs/STAGING.md).

**Deploying to production (env, Docker, migrations, health checks, security checklist):** [docs/PRODUCTION.md](docs/PRODUCTION.md) · `deploy/Dockerfile.api`, `deploy/Dockerfile.web`, `deploy/docker-compose.prod.yml`.

## Prerequisites

- **Node.js 20+** (LTS)
- **npm 9+** (workspaces) or **pnpm 9+** (see `packageManager` in the root `package.json`)
- **Docker** (for Postgres and Redis) — or your own **PostgreSQL 15+** URL

## Setup

```bash
npm install
# or: pnpm install

# Required before the API or web can import @car-rental/shared from disk
npm run build -w @car-rental/shared
# or: pnpm --filter @car-rental/shared run build
```

## Database, schema, and Prisma client

1. **Start** Postgres and Redis: `docker compose up -d`

2. **Env:** copy `apps/api/.env.example` → `apps/api/.env` and set at least `DATABASE_URL`, `PORT`, and **`JWT_SECRET`** (use a long random value in any shared or production environment).

3. **Apply schema (dev):** from the repository root

   ```bash
   npm run db:push
   ```

   Or: `cd apps/api && npx prisma migrate dev` to use the SQL migration in `prisma/migrations/`.

4. **Generate the Prisma client** (required for `import '@prisma/client'`):

   ```bash
   npm run prisma:generate
   ```

**Windows:** run Prisma with **`npx` from Command Prompt (cmd)**, not PowerShell, if you hit odd behavior. The repo’s **`scripts/prisma-generate-retry.cjs`** (used by `npm run prisma:generate` in **`apps/api`**) retries **`prisma generate`** and, on failure, can **copy** the newest `query_engine-windows.dll.node.tmp*` to `query_engine-windows.dll.node` when the usual rename step hits **EBUSY** (antivirus, search indexers, or a locked DLL). If problems persist, exclude the repo’s `node_modules` from real-time AV, close other Node/IDE uses of the engine, or use WSL. After a successful generate, the API can be built. CI in `.github/workflows/ci.yml` uses Ubuntu as the reference for a full build.

## Run the API (development)

```bash
npm run build -w @car-rental/shared
npm run dev:api
# or: npm run build -w @car-rental/shared && npm run dev -w @car-rental/api
# GET http://localhost:3000/v1/health  (no token) · GET /v1/health/ready (DB check, 503 if down)
# OpenAPI: GET http://localhost:3000/docs  (and /docs-json) if SWAGGER is enabled (default off in production)
# Per-IP rate limits apply (throttler); health + Stripe webhook are excluded; login/register are stricter.
# CRUD: /v1/companies, /v1/stations?companyId=  (header: Authorization: Bearer <accessToken>)
# POST /v1/auth/login  { "email", "password" }  →  { "accessToken", "user" }
# GET /v1/auth/me  (Bearer)
# npm run db:seed   # from repo root; demo org + fleet + admin (admin@demo.local) + agent (agent@demo.local), password Change-me!23456 unless SEED_* env set. Set NEXT_PUBLIC_DEFAULT_COMPANY_ID in web .env.local to the printed company UUID (default 00000000-0000-4000-8000-000000000001 on fresh seed).
# Non-ADMIN users are scoped to their company; see docs/CODEBASE.md for @Roles and READONLY.
```

## Run the web app (development)

```bash
npm run build -w @car-rental/shared
npm run dev -w @car-rental/web
# http://localhost:3001
```

Optional: `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:3000/v1`, optional `NEXT_PUBLIC_DEFAULT_COMPANY_ID=<uuid from seed or desk>` to prefill and auto-load **public** catalog on `/quote`, and (for VAT on the **desk** rate quote panel) `NEXT_PUBLIC_VAT_RATE=0.22` (0–1; `0` hides VAT; see `apps/web/.env.local.example`).

**Public (no login):** `http://localhost:3001/quote` — **indicative** rent total and **available vehicle count** (`GET /v1/public/catalog`, `/v1/public/quote`, `/v1/public/availability/vehicles`); optional **`POST /v1/public/quote-reservations`** creates a **QUOTE** draft (contact details + first free vehicle in class; stricter rate limit) so staff can follow up in **Reservations**. All throttled, unauthenticated.

**Back office (web):** `http://localhost:3001/auth` (or `/login` → redirects) — JWT in `localStorage`. **Company & stations:** create/edit **stations**; set **one-way drop fee (cents)** on the company when pickup/return stations differ. **Fleet:** create/edit **vehicle classes** (incl. **seasonal** daily windows) and **vehicles**; **rate quote** (per-day class rate × 24h days + optional one-way, `GET /rates/quote`). **Reservations:** create/edit, **line-item extras** (auto total only; table column **Extras**), **Quick steps** in the list (one-click `PATCH` status: confirm, pending payment, start rental, complete, no-show, cancel), **check availability** at pickup home station, delete **QUOTE** drafts.

## Run from repo root (Turborepo)

```bash
npm run build
npm run dev
```

`turbo` runs all workspace `dev` / `build` tasks; for day-to-day work, prefer the commands above. After changing `packages/shared`, rebuild it before the API or web.

## MinIO (optional — S3-compatible storage)

For presigned **agreement** uploads (`STORAGE_MODE=s3` in `apps/api/.env`), run MinIO, create a bucket, and set [CORS](https://min.io/docs/minio/linux/administration/object-management.html#configure-the-cors) so your **desk** origin can `PUT` to presigned URLs (e.g. `http://localhost:3001`). `docker compose` includes a `minio` service (API `9000`, console `9001`, dev credentials in `docker-compose.yml`).

## Worker (CaRGOS D4/D5)

Polls the database for `PENDING` `CargosSubmission` rows. Per company (**Organization → CaRGOS** on the desk): **MOCK** (simulated), **HTTP** (POST JSON to your middleware URL; on success, same as sent), or **OFF** / out of scope → **SKIPPED**. **No Redis/BullMQ** — v1 is a single-process poller. Use the **same** `DATABASE_URL` as the API (after migrations). Optional env: `WORKER_POLL_IDLE_MS` (default 2000); `WORKER_CARGOS_MOCK_DELAY_MS` (default 400); `WORKER_PROCESSING_STALE_MS` (default 15 min, min 60s) for stuck `PROCESSING` rows; **`CARGOS_MAX_ATTEMPTS`** (default 5) and **`CARGOS_HTTP_TIMEOUT_MS`** (default 30s) for **HTTP** retries. See `apps/api/.env.example`. From repo root:

```bash
set DATABASE_URL=postgresql://...   # Windows: same as apps/api — or export on Unix
npm run dev:worker
# equivalent: npm run build -w @car-rental/worker && node apps/worker/dist/main.js
```

## Next implementation phases (from ARCHITECTURE)

1. **Phase 0–1** (skeleton in repo): monorepo, health, `Company` + `Station`, Prisma, Docker, worker stub.
2. **Fleet (in repo):** `VehicleClass`, `Vehicle`, `CalendarBlock`, availability.
3. **Reservations (in repo):** `Reservation` + **statuses**; **GET/POST/PATCH/DELETE** (draft delete); availability excludes **active** reservations; optional **`totalCents`**; auto-total from **class** day rate + **one-way** + **`ReservationExtraLine`** when `totalCents` is omitted.
4. **Auth (in repo):** users, roles, JWT, audit, company scoping.
5. **Pricing (v1 in repo):** per-class `defaultDailyCents` / `defaultDepositCents`, optional **seasonal** `VehicleClassSeasonalRate` + `sumClassRentCents24h`, **`GET /v1/rates/quote`**, 24h rental days in `@car-rental/shared`.
6. **Next:** **Stripe** deposit holds / **PSD2** hardening; **CaRGOS** real portale — TBD. (v1: Stripe **Checkout**; **agreements** + attachments; **CaRGOS** enqueue + stub worker + desk **Enqueue CaRGOS stub**.)

---

This software is a technical scaffold only; **legal**, **fiscal**, and **CaRGOS** behaviour must be validated with your counsel and the Polizia / SDI process.
