import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_VERSION } from '@car-rental/shared';
import helmet from 'helmet';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

/**
 * `CORS_ORIGINS`: comma-separated list (e.g. `https://app.example.com,https://www.example.com`).
 * If unset, allows the default local desk UI (`http://localhost:3001`, `http://127.0.0.1:3001`).
 * In **production**, `validateEnv` requires this to be set explicitly.
 */
function buildCorsOrigin(config: ConfigService): true | string[] {
  const raw = config.get<string>('CORS_ORIGINS')?.trim();
  if (!raw) {
    return ['http://localhost:3001', 'http://127.0.0.1:3001'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function trustProxyFromConfig(config: ConfigService): boolean {
  const v = config.get<string | boolean>('TRUST_PROXY');
  return v === true || v === '1' || v === 'true' || v === 'yes';
}

/** H1: OpenAPI. Default off in production unless `SWAGGER_ENABLE=1`. */
function isSwaggerEnabled(config: ConfigService, nodeEnv: string): boolean {
  const raw = String(config.get('SWAGGER_ENABLE') ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no') {
    return false;
  }
  return nodeEnv !== 'production';
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const globalPrefix = 'v1';

  if (nodeEnv === 'production') {
    app.useLogger(['error', 'warn', 'log']);
  }
  app.enableShutdownHooks();

  if (trustProxyFromConfig(config)) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    logger.log('Express trust proxy enabled (use behind reverse proxy / load balancer)');
  }

  /** JSON API: no CSP; avoid breaking web clients with strict CORP defaults. */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (isSwaggerEnabled(config, nodeEnv)) {
    const swaggerDoc = new DocumentBuilder()
      .setTitle('Car rental API')
      .setDescription(
          'REST **v1** (global prefix). Use **Authorize** **`access-token`** with a JWT from `POST /v1/auth/login`. ' +
          'Partner routes use **`partner-bearer`** (legacy `crtp_…` or OAuth access token) or **`X-Partner-Key`** (`partner-key`). ' +
          'Unauthenticated routes include `GET /v1/health*`, **`GET /v1/metrics`** (Prometheus exposition, A6), public auth register/login, `GET/POST /v1/public/*` (including C3 `POST /public/reservations/request-view-link`), G2 partner **`POST /v1/partner/oauth/token`** (OAuth2 client_credentials) + **`GET /v1/partner/me`** (key context) + `POST|GET|PATCH /v1/partner/reservations*` (`Authorization: Bearer` = **`crtp_…`** legacy key or **short-lived OAuth access token**, or `X-Partner-Key`; **`PATCH …/reservations/:id`** cancel-only body `{ "status": "CANCELLED" }`), `POST /v1/payments/stripe/webhook`, `POST /v1/integrations/sdi/callback`, and worker cron `POST /v1/internal/cron/rent-payment-reminders` / `…/service-due-maintenance-blocks` / `…/customer-document-ocr` / `…/customer-document-ocr-callback` / `…/partner-webhook-deliveries` (Bearer `WORKER_INTERNAL_SECRET`) (see `@Public()` in source). ' +
          'Zod still validates most bodies; prefer shared schemas in the repo for exact shapes.',
      )
      .setVersion(API_VERSION)
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'PartnerKeyOrOAuthJWT',
          description:
            'Partner **B2B**: legacy `crtp_<uuid>_<secret>` or short-lived OAuth2 access token from `POST /v1/partner/oauth/token`. Not the staff desk JWT.',
        },
        'partner-bearer',
      )
      .addApiKey(
        { type: 'apiKey', name: 'X-Partner-Key', in: 'header' },
        'partner-key',
      )
      .addTag('Health', 'Liveness, readiness, monitoring summary (no auth)')
      .addTag('Auth', 'Login, register, MFA, current user')
      .addTag(
        'Public',
        'Unauthenticated web quote + availability + view-by-token (throttled; catalog/quote need `companyId`)',
      )
      .addTag('Organization', 'Companies, stations, staff, customers (JWT)')
      .addTag('Invoices', 'Create, issue, void invoices (JWT)')
      .addTag('Agreements', 'Rental agreements, attachments, e-sign (JWT)')
      .addTag('Reservations', 'Desk reservations, ops, handover, damage (JWT)')
      .addTag(
        'Partner',
        'B2B partner API (`partner-bearer` or `X-Partner-Key`; not staff JWT). When a webhook URL + secret are set on the key, deliveries use `X-Partner-Event` values **`reservation.created`**, **`reservation.cancelled`**, **`reservation.status_changed`** (HMAC body — see PRODUCTION.md G2).',
      )
      .addTag('Integrations', 'Stripe, CaRGOS, SDI (see route-level auth)')
      .addTag('Reports', 'Company aggregates (G1)')
      .build();
    const openApi = SwaggerModule.createDocument(app, swaggerDoc, {
      operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
    });
    SwaggerModule.setup('docs', app, openApi, {
      useGlobalPrefix: false,
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(
      `OpenAPI (H1) http://0.0.0.0:${port}/docs  —  JSON: http://0.0.0.0:${port}/docs-json  (v1 JSON API remains under /${globalPrefix}/)`,
    );
  }

  const mfaPol = String(config.get('AUTH_MFA_REQUIRED') ?? '').trim().toLowerCase();
  if (mfaPol === '1' || mfaPol === 'true' || mfaPol === 'yes') {
    logger.warn(
      'AUTH_MFA_REQUIRED: ADMIN / BRANCH_MANAGER must enroll MFA before access (or use pending TOTP setup); see PRODUCTION.md',
    );
  }

  const origin = buildCorsOrigin(config);
  app.enableCors({
    origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Stripe-Signature', 'X-Partner-Key'],
  });
  await app.listen(port, '0.0.0.0');
  logger.log(`API ${nodeEnv} http://0.0.0.0:${port}/${globalPrefix}/health`);
}

void bootstrap();
