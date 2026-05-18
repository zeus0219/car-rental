import { z } from 'zod';

const boolish = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => v === true || v === '1' || v === 'true' || v === 'yes');

/**
 * Fails fast on boot when required variables are missing or unsafe for production.
 * Wired via `ConfigModule.forRoot({ validate: validateEnv })`.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const schema = z
    .object({
      NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
      DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
      /**
       * A6: optional `redis://…` — when set, `@nestjs/throttler` uses Redis instead of in-memory
       * (required for correct rate limits across multiple API instances).
       */
      REDIS_URL: z.string().min(1).optional(),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      /** Minimum length enforced in **production** only (see superRefine). */
      JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
      /** Comma-separated browser origins. In production, must be set explicitly (not omitted). */
      CORS_ORIGINS: z.string().optional(),
      /** Behind reverse proxy (nginx, ALB) — set so `req.ip` and rate limits use `X-Forwarded-For`. */
      TRUST_PROXY: boolish.optional(),
      /** Optional SMTP (C2) — if `SMTP_HOST` is set, `SMTP_FROM` is required in MailService. */
      SMTP_HOST: z.string().optional(),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
      SMTP_SECURE: boolish.optional(),
      SMTP_USER: z.string().optional(),
      SMTP_PASS: z.string().optional(),
      SMTP_FROM: z.string().optional(),
      /** Public web base URL (https://…) for links in transactional emails, e.g. /quote, /auth/reset-password */
      APP_PUBLIC_BASE_URL: z.string().optional(),
      /** H2: staff password reset link lifetime in minutes (default 60; max 24h) */
      PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).optional(),
      /** `false` / `0` / `no` to skip Stripe Checkout link emails; omit to send (when SMTP is configured). */
      EMAIL_STRIPE_CHECKOUT_LINKS: z.string().optional(),
      /** `false` / `0` / `no` to skip rental “paid” + deposit “hold active” emails from Stripe webhooks. */
      EMAIL_STRIPE_WEBHOOK_EMAILS: z.string().optional(),
      /** C2: Twilio — all three required for SMS; optional otherwise. */
      TWILIO_ACCOUNT_SID: z.string().optional(),
      TWILIO_AUTH_TOKEN: z.string().optional(),
      TWILIO_FROM_NUMBER: z.string().optional(),
      /** When `true` with Twilio configured, send a short SMS after public multi-line quote batch save. */
      SMS_PUBLIC_BATCH_ACK: z.string().optional(),
      /** C2: worker/cron `Authorization: Bearer …` for `POST /v1/internal/cron/rent-payment-reminders` (use ≥16 random chars when set). */
      WORKER_INTERNAL_SECRET: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().optional(),
      ),
      /** C2: rent dunning — requires SMTP + APP_PUBLIC_BASE_URL for links. */
      EMAIL_RENT_PAYMENT_REMINDERS: z.string().optional(),
      /** When truthy with SMTP, send a short email to the customer after desk **POST /customers** (off by default; GDPR/consent is your policy). */
      MAIL_DESK_CUSTOMER_WELCOME: z.string().optional(),
      RENT_REMINDER_BATCH_LIMIT: z.coerce.number().int().min(1).max(500).optional(),
      RENT_REMINDER_MIN_RESERVATION_AGE_HOURS: z.coerce.number().int().min(1).max(720).optional(),
      RENT_REMINDER_MIN_LEAD_HOURS_BEFORE_PICKUP: z.coerce.number().int().min(1).max(720).optional(),
      /** F3: set `1`/`true` with `WORKER_INTERNAL_SECRET` to allow auto MAINTENANCE `CalendarBlock` when service km due. */
      SERVICE_DUE_AUTO_BLOCKS: z.string().optional(),
      SERVICE_DUE_BLOCK_BATCH_LIMIT: z.coerce.number().int().min(1).max(200).optional(),
      /** C3: HMAC secret for /booking/view?magic= links (≥16 chars). */
      PUBLIC_BOOKING_MAGIC_SECRET: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().optional(),
      ),
      PUBLIC_BOOKING_MAGIC_TTL_MINUTES: z.coerce.number().int().min(15).max(20160).optional(),
      /**
       * H1: OpenAPI UI at `GET /docs` (and spec JSON at `/docs-json`). When **unset**:
       * enabled in `development` / `test`, **disabled in production** (set to `1` to enable in prod).
       */
      SWAGGER_ENABLE: z.string().optional(),
      /** A2: max failed **password** attempts before `lockedUntil` (0 or unset = lockout disabled). */
      AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(100).optional(),
      /** A2: lockout duration in minutes when max attempts reached (default 15; max 24h). */
      AUTH_LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(24 * 60).optional(),
      /**
       * A2: when true, a successful password check must also pass `strongPasswordSchema` (bootstrap off;
       * turn on after users have rotated passwords via forgot-password / change-password).
       */
      AUTH_LOGIN_REQUIRE_STRONG_PASSWORD: boolish.optional(),
      /**
       * A3: when true, `ADMIN` / `BRANCH_MANAGER` cannot sign in without MFA enabled, except while
       * TOTP setup is in progress (`mfaSecret` set, not yet confirmed). Bootstrap: leave false until
       * privileged users have enrolled MFA, then set true. See PRODUCTION.md.
       */
      AUTH_MFA_REQUIRED: boolish.optional(),
      /**
       * When `1`/`true`/`yes`, **`ADMIN`** staff are **company-bound** like other roles: no cross-tenant
       * `assertSameCompany` bypass, `GET /companies` returns only their `companyId`, and list filters cannot
       * span dealers. Recommended for per-dealer production. See **docs/STRUCTURE.md** §7.
       */
      ENFORCE_STAFF_SINGLE_COMPANY: boolish.optional(),
      /** D4: same semantics as worker — used when desk calls “Transmit now”. */
      /** Optional full URL for `POST /v1/integrations/sdi/callback` — included in HTTP handoff JSON for async SDI middleware (E4). */
      SDI_CALLBACK_URL: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().url().optional(),
      ),
      /** Shared secret; middleware must send `Authorization: Bearer <secret>` on callback. */
      SDI_CALLBACK_SECRET: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().min(8).optional(),
      ),
      /** F1–F2: optional `PATCH` to `COMPLETED` gates (default off). */
      RETURN_REQUIRE_ODOMETER_IN: boolish.optional(),
      RETURN_REQUIRE_RETURN_CHECKLIST: boolish.optional(),
      RETURN_REQUIRE_FUEL_IN: boolish.optional(),
      /**
       * G3: when `mock` or `http`, completed uploads set `CustomerDocument.ocrStatus=PENDING` for
       * `POST /v1/internal/cron/customer-document-ocr`.
       */
      CUSTOMER_DOCUMENT_OCR_AUTO: z.string().optional(),
      /** G3: max rows per cron batch (default 20; clamped 1–100). */
      CUSTOMER_DOCUMENT_OCR_CRON_BATCH: z.coerce.number().int().min(1).max(100).optional(),
      /** G3: OCR adapter POST URL when `CUSTOMER_DOCUMENT_OCR_AUTO=http`. */
      CUSTOMER_DOCUMENT_OCR_HTTP_URL: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().url().optional(),
      ),
      /** G3: optional `Authorization: Bearer …` for the HTTP OCR adapter. */
      CUSTOMER_DOCUMENT_OCR_HTTP_SECRET: z.string().optional(),
      /** G3: HTTP OCR request timeout in ms (clamped 5000–120000 in app code; default 30000). */
      CUSTOMER_DOCUMENT_OCR_HTTP_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).optional(),
      /** G3: stored on `CustomerDocument.ocrVendor` for HTTP runs (default `HTTP`, max 64 chars). */
      CUSTOMER_DOCUMENT_OCR_HTTP_VENDOR: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().max(64).optional(),
      ),
      /** G2: max `PartnerWebhookDelivery` rows per `POST …/internal/cron/partner-webhook-deliveries` (default 20; clamped in service 1–100). */
      PARTNER_WEBHOOK_CRON_BATCH: z.coerce.number().int().min(1).max(100).optional(),
      /** G2 (depth): optional comma-separated IPv4 allowlist for `/v1/partner/*` (single IPs or `cidr`, e.g. `203.0.113.0/24`). Requires correct `TRUST_PROXY` + `req.ip`. */
      PARTNER_API_ALLOWED_IP_CIDRS: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().max(4000).optional(),
      ),
      /** G3: when `1`/`true` and `STORAGE_MODE=s3`, OCR HTTP POST includes short-lived `documentDownloadUrl` (presigned GET). */
      CUSTOMER_DOCUMENT_OCR_HTTP_INCLUDE_PRESIGNED_GET: z.string().optional(),
      /** G3: presigned GET lifetime for OCR adapter (seconds; default 300; clamped 60–3600 in service). */
      CUSTOMER_DOCUMENT_OCR_HTTP_PRESIGN_GET_SECONDS: z.coerce.number().int().min(60).max(3600).optional(),
      /** G3: optional HMAC-SHA256 on OCR POST body: headers `X-CarRental-Ocr-Timestamp` (unix sec) + `X-CarRental-Ocr-Signature` (hex of `HMAC(secret, timestamp + "." + bodyutf8)`). */
      CUSTOMER_DOCUMENT_OCR_HTTP_HMAC_SECRET: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().optional(),
      ),
      /** G2: attempts before `DEAD` (default 8; clamped in service 1–50). */
      PARTNER_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).optional(),
      /** G2: reclaim stuck `PROCESSING` rows after this many ms (default 900_000; clamped 60_000–3_600_000). */
      PARTNER_WEBHOOK_STALE_MS: z.coerce.number().int().min(60_000).max(3_600_000).optional(),
      /**
       * G2: signing secret for partner OAuth access tokens (`POST /v1/partner/oauth/token`). Strongly recommended
       * separate from `JWT_SECRET` in production. Falls back to `JWT_SECRET` when unset (dev only).
       */
      PARTNER_OAUTH_JWT_SECRET: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().min(16).optional(),
      ),
      /** G2: partner access token lifetime in seconds (default 3600; clamped 300–86400 in service). */
      PARTNER_OAUTH_ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(300).max(86_400).optional(),
      /** G2: when set, `/v1/partner/*` requires mTLS verification header from the edge (see PARTNER_MTLS_VERIFIED_*). */
      PARTNER_MTLS_REQUIRE: z.string().optional(),
      /** G2: header the reverse proxy sets when client cert verified (default `X-Client-Cert-Verified`). */
      PARTNER_MTLS_VERIFIED_HEADER_NAME: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().max(128).optional(),
      ),
      /** G2: required header value when `PARTNER_MTLS_REQUIRE` is on (default `SUCCESS`, as in nginx `ssl_client_verify`). */
      PARTNER_MTLS_VERIFIED_HEADER_VALUE: z.preprocess(
        (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
        z.string().max(64).optional(),
      ),
    })
    .superRefine((data, ctx) => {
      if (data.NODE_ENV === 'production' && data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message:
            'JWT_SECRET must be at least 32 characters in production (use a long random value)',
        });
      }
      if (data.NODE_ENV === 'production' && !data.CORS_ORIGINS?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message:
            'CORS_ORIGINS must be set in production (comma-separated https origins for your web app)',
        });
      }
      if (data.NODE_ENV === 'production') {
        const jwt = data.JWT_SECRET.trim();
        const lower = jwt.toLowerCase();
        const looksPlaceholder =
          lower.includes('change-me') ||
          lower.includes('changeme') ||
          lower.includes('dev-insecure') ||
          lower === 'secret' ||
          lower === 'jwt_secret' ||
          lower === 'password' ||
          /^replacedummy/.test(lower);
        if (looksPlaceholder) {
          ctx.addIssue({
            code: 'custom',
            path: ['JWT_SECRET'],
            message:
              'JWT_SECRET must be a high-entropy random value in production, not a placeholder (generate e.g. openssl rand -base64 32)',
          });
        }
      }
      const ocrAuto = data.CUSTOMER_DOCUMENT_OCR_AUTO?.trim().toLowerCase() ?? '';
      if (ocrAuto === 'http' && !data.CUSTOMER_DOCUMENT_OCR_HTTP_URL?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['CUSTOMER_DOCUMENT_OCR_HTTP_URL'],
          message:
            'CUSTOMER_DOCUMENT_OCR_HTTP_URL is required when CUSTOMER_DOCUMENT_OCR_AUTO=http',
        });
      }
      const partnerOauth = data.PARTNER_OAUTH_JWT_SECRET?.trim() ?? '';
      if (data.NODE_ENV === 'production' && partnerOauth.length > 0 && partnerOauth.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['PARTNER_OAUTH_JWT_SECRET'],
          message:
            'PARTNER_OAUTH_JWT_SECRET must be at least 32 characters in production when set (use openssl rand -base64 32)',
        });
      }
    });

  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment — ${msg}`);
  }
  return config;
}
