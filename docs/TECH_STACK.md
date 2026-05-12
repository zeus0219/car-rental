# Selected technology stack (all TypeScript)

This document records the **chosen** stack for the Italy-oriented car rental platform described in [ARCHITECTURE.md](../ARCHITECTURE.md). It is a **decision record** for implementation; change it when you adopt a different vendor (e.g. PSP) or split services.

**Where that stack appears in this repo** (packages, Nest modules, Prisma models, Next routes): [STRUCTURE.md](STRUCTURE.md). **Gaps to a full production system (backlog, ordered):** [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).

---

## 1. Decision summary

| Area | Selection |
|------|------------|
| **Language** | **TypeScript** (strict), **Node.js 20+** (LTS) |
| **Architecture** | **Modular monolith** (NestJS) + **background workers** (BullMQ), same repository |
| **API** | **REST** (`/v1/...`), **OpenAPI** (H1: **`@nestjs/swagger`** — **`/docs`**, **`/docs-json`**) — see **PRODUCTION.md** (prod off by default) |
| **Web (customer + ops)** | **Next.js** (App Router), **React 18+** |
| **Database** | **PostgreSQL 15+** |
| **ORM / migrations** | **Prisma** *(or **Drizzle** if the team prefers SQL-first)* |
| **Cache / queue** | **Redis 7+** + **BullMQ** |
| **Object storage** | **S3-compatible** (EU region, e.g. Milan / Frankfurt) |
| **Auth (staff)** | **Auth.js (NextAuth)** or **Better Auth** — **2FA** required for admin roles |
| **Auth (customers)** | Magic link + booking ref (MVP), or same Auth.js with email provider |
| **Payments** | **Stripe** *(evaluate **Adyen** / **Nexi** if contract or Italian acquirer requires)* |
| **Transactional email (v1 in repo)** | **nodemailer** + SMTP — quote ack, Stripe **pay links**, **webhook** rental paid + deposit hold (env opt-outs) |
| **Validation / shared types** | **Zod** + shared `packages/shared` (schemas exported to web and API) |
| **UI** | **Tailwind CSS** + **shadcn/ui** (or **MUI**) |
| **Client data fetching** | **TanStack Query** |
| **Forms** | **React Hook Form** + **Zod** resolvers |
| **PDF** | **@react-pdf/renderer** or **pdf-lib** (single team convention) |
| **Monorepo** | **pnpm** + **Turborepo** |
| **Quality** | **ESLint** + **Prettier** (or **Biome**) |
| **Containers** | **Docker** multi-stage; separate **API**, **worker**, **Next** processes or images |
| **Observability** | **OpenTelemetry** + **Sentry** (or similar) for API/worker and critical jobs (CaRGOS, payments) |

**Rationale:** one language across API, workers, and web; strong typing for contracts and fiscal fields; mature libraries for queues, uploads, and **PSD2** card flows; EU hosting and subprocessors easier to reason about for **GDPR**.

**Out of scope for v1:** separate **GraphQL/tRPC** unless the product team requires it; **native** mobile apps (prefer **responsive** or **PWA** first).

---

## 2. Repository layout (target)

```
apps/
  api/                 # NestJS — HTTP API + domain modules
  worker/              # BullMQ processors (or second entrypoint in api/ — pick one)
  web/                 # Next.js — public booking + customer area (or split later)
  ops/                 # Next.js — back office (optional: merge with web via route groups)
packages/
  shared/              # Zod schemas, shared types, constants
  config-eslint/       # optional — shared ESLint config
  ui/                  # optional — shared React components
```

**Note:** You can start with **`apps/api`** + **`apps/web`** only and add **`apps/ops`** when the back office grows, or use **one** Next app with `app/(public)` and `app/(ops)` route groups.

---

## 3. Backend (NestJS)

- **Modules** align with [ARCHITECTURE.md](../ARCHITECTURE.md) domains: e.g. `Organization`, `Fleet`, `Reservations`, `Customers`, `Agreements`, `Cargos` (Italy), `Payments`, `Maintenance`, `Reporting`.
- **Inbound DTOs:** `class-validator` / `class-transformer` **or** **Zod** + `nestjs-zod` — keep **one** style project-wide.
- **Outbound:** DTO classes or shared Zod → TypeScript types for the front end via `packages/shared`.
- **Integrations** live in **`infrastructure/`** adapters: `CaRGOSClient`, `StripeAdapter`, `StorageAdapter`, `SdiClient` (stub until fiscal phase).
- **Config:** `@nestjs/config`; secrets from **environment** / **secret manager** (never commit **CaRGOS** or **Stripe** keys).

---

## 4. Workers (BullMQ + v1 pollers)

- **Long-term (target):** **BullMQ** on **Redis** — queues such as `cargos.submit`, `payments.webhook`, `email.send`, `ocr.process`, `sdi.submit` (later).
- **v1 in this repo:** **`apps/worker`** is a **database poller** (same `DATABASE_URL` as the API): `PENDING` **CaRGOS** rows → per-company **MOCK** / **HTTP** / **SKIPPED**, retries + stale **`PROCESSING`** recovery. No Redis for this path yet. Env: `CARGOS_MAX_ATTEMPTS`, `CARGOS_HTTP_TIMEOUT_MS`, `WORKER_PROCESSING_STALE_MS`, etc. The worker may also **HTTP-call** the API’s **`POST /v1/internal/cron/*`** routes when **`WORKER_INTERNAL_SECRET`** is set (rent reminders, service-due blocks, optional **G3** customer-document OCR, optional **G2** **`partner-webhook-deliveries`**) — bounded batches on the API, not BullMQ.
- **Idempotency:** store **idempotency keys** in **PostgreSQL** (per [ARCHITECTURE.md](../ARCHITECTURE.md) for CaRGOS and PSP webhooks).
- **Deployment:** dedicated **`Dockerfile.worker`** or same image with a different **CMD**; add **Redis** URL when you introduce **BullMQ** jobs.

---

## 5. Front end (Next.js)

- **App Router**, **Server Components** where they reduce bundle size; **client** components for forms, maps, file upload.
- **Two surfaces:** public **booking** and **back office** — separate auth cookies / middleware paths for ops.
- **i18n:** Italian first; structure for **it** / **en** if you need tourism market (use `next-intl` or similar when ready).

---

## 6. Data and storage

- **PostgreSQL:** managed in **EU**; **Point-in-time recovery** (PITR) for production.
- **Migrations:** Prisma Migrate or Drizzle Kit only; run in **CI** before deploy.
- **S3-compatible:** private buckets; **presigned URLs** for document upload; lifecycle rules per **privacy** retention policy.
- **Redis:** managed; **persistence** optional (AOF) if you rely on queue durability—**BullMQ** + **Postgres** job state for critical side effects is safer for money and compliance.

---

## 7. Payments (Italy / PSD2)

- **Stripe** (default): Node SDK, **Checkout** or **Payment Element**, **webhooks** with **signature verification** and **deduplication** table.
- **Deposits:** **PaymentIntents** with **capture** later; document **excess** / damage fees in your domain model before capture.
- **SCA:** follow Stripe’s **3DS** flows; do not disable for “convenience” without legal and risk review.

---

## 8. CaRGOS (Italy)

- Implementation is **adapter-based** (D4: **MOCK** / **HTTP** to tenant URL in repo; no guaranteed official public REST from Polizia). Stack choice does not replace **Questura** onboarding and **credentials** (D6).
- **D5 in repo:** per-**Company** in-scope, **TEST/PRODUCTION**, adapter, **HTTP** URL, cutoff minutes; per-**Station** **location** code on the HTTP JSON (**`station.cargosLocationCode`** and legacy flat **`stationCargosLocationCode`**).
- **HTTP contract:** shared **`CargosHttpAdapterPayload`**, **`specVersion` 1** (trip, vehicle/class, nested station + renter + linked **Customer** B3 fields + **RentalAgreement** status).
- **Worker** (poller) + **retries** + **no** secrets in logs; add **alerting** in ops (monitor worker exit codes / **FAILED** submissions).

---

## 9. SDI / e-invoicing (later)

- Keep **invoice** and **customer fiscal** fields in the **schema** early ([ARCHITECTURE.md](../ARCHITECTURE.md) Phase 8).
- **XML / PEC / SDI** may use a **dedicated** microservice or **external** fiscal provider; if you stay all-TS, evaluate **SOAP/XSD** complexity before committing—some teams use a **small .NET** sidecar for Italian **SDI** only.

---

## 10. Environments

| Environment | Purpose |
|-------------|---------|
| **dev** | Local Docker Compose: Postgres, Redis, MinIO (S3 API), mail catcher |
| **staging** | EU region; **Stripe test**; **no** production **CaRGOS** credentials |
| **prod** | EU region; live PSP; **CaRGOS** prod per **Questura** rules |

---

## 11. Alternatives not selected (short)

| Alternative | Why not default |
|-------------|------------------|
| **Fastify** instead of Nest | Less structure; fine if the team strongly prefers minimal framework—then enforce **strict** folder rules by hand. |
| **Drizzle** instead of Prisma | Choose if you want lighter runtime and raw SQL in hot paths. |
| **tRPC** | Adds coupling; REST + **Zod** in `shared` is enough for one org’s web + API. |
| **MongoDB** | Relational model (reservations, overlaps, invoices) fits **Postgres** better. |

---

## 12. Document history

- **2026-04-24** — Initial **selected** all-**TypeScript** stack for this project.
- **2026-04-24** — Moved to `docs/TECH_STACK.md`.
- **2026-04-24** — **§4** / **§8:** v1 `apps/worker` CaRGOS poller (D4/D5) vs future BullMQ.

---

*Update this file when you pin major versions (Node LTS, Nest major) or change PSP/storage region.*
