import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createReservationSchema, partnerCancelReservationBodySchema } from '@car-rental/shared';
import { z } from 'zod';
import { Public } from '../auth/public.decorator';
import { ReservationService } from '../reservation/reservation.service';
import { PartnerApiKeyService } from './partner-api-key.service';
import { PartnerKeyGuard } from './partner-key.guard';
import { PartnerCtx } from './partner-key.decorator';
import type { PartnerRequestContext } from './partner.types';
import type { Request } from 'express';

@ApiTags('Partner')
@ApiSecurity('partner-bearer')
@ApiHeader({ name: 'X-Partner-Key', required: false, description: 'Alternative to Bearer `crtp_…` or OAuth access token' })
@Public()
@UseGuards(PartnerKeyGuard)
@Controller('partner')
export class PartnerReservationsController {
  constructor(
    private readonly reservations: ReservationService,
    private readonly partnerKeys: PartnerApiKeyService,
  ) {}

  @Get('me')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Integration context for this API key',
    description:
      'Returns **`partnerApiKeyId`**, **`companyId`**, desk **`name`**, **`createdAt`**, **`apiVersion`** (shared REST **`v1`** contract tag), and **`webhookDeliveryEnabled`** (whether an **HTTPS** webhook URL + signing secret are configured — same gate as enqueueing **`reservation.created`** / **`reservation.cancelled`**). No secrets or webhook URL are returned.',
  })
  me(@PartnerCtx() partner: PartnerRequestContext) {
    return this.partnerKeys.integrationContextForKey(partner.partnerApiKeyId);
  }

  @Post('reservations')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. Same key + same JSON body returns the same reservation; same key with different body → 409. Max 256 characters.',
  })
  @ApiOperation({
    summary: 'Create reservation (partner / B2B)',
    description:
      'Authenticate with **`Authorization: Bearer`** — legacy **`crtp_<uuid>_<secret>`** or **OAuth2 access token** from **`POST /v1/partner/oauth/token`** (client_credentials); or **`X-Partner-Key`** with the legacy key. `companyId` in the body must match the key. Rate limit: **120 requests / minute / IP** (in addition to global HTTP throttler). When **`PARTNER_API_ALLOWED_IP_CIDRS`** or per-key **`PATCH …/partner-api-keys/:id/allowed-ip-cidrs`** is set, only matching **IPv4** client addresses (see **`TRUST_PROXY`**, **AND** when both are set) may call the Partner API. When **`PARTNER_MTLS_REQUIRE`** is set, the edge must send the configured mTLS verification header.',
  })
  create(
    @Body() body: unknown,
    @PartnerCtx() partner: PartnerRequestContext,
    @Req() req: Request,
  ) {
    const data = createReservationSchema.parse(body);
    const raw = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof raw === 'string' ? raw : Array.isArray(raw) && raw[0] ? raw[0] : undefined;
    return this.reservations.createForPartner(data, {
      companyId: partner.companyId,
      partnerApiKeyId: partner.partnerApiKeyId,
      ip: req.ip || undefined,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      idempotencyKey: idempotencyKey?.trim() || null,
    });
  }

  @Get('reservations')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List PARTNER-sourced reservations',
    description:
      'Returns reservations created via the partner API (`source: PARTNER`) for this key’s company. Newest first (`createdAt` desc). Optional `status` (same values as staff). Pagination: `limit` (default 25, max 100), `offset` (max 50000).',
  })
  list(
    @PartnerCtx() partner: PartnerRequestContext,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('status') status: string | undefined,
  ) {
    const p = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(50_000).default(0),
        status: z.string().max(32).optional(),
      })
      .strict()
      .safeParse({ limit, offset, status });
    if (!p.success) {
      throw new BadRequestException('Invalid query (limit 1–100, offset 0–50000, status optional)');
    }
    return this.reservations.listForPartner(partner.companyId, p.data);
  }

  @Get('reservations/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get one PARTNER-sourced reservation',
    description: 'Only reservations created via the partner API (`source: PARTNER`) are returned.',
  })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @PartnerCtx() partner: PartnerRequestContext) {
    return this.reservations.getOneForPartner(id, partner.companyId);
  }

  @Patch('reservations/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cancel a PARTNER-sourced reservation',
    description:
      'Body must be **`{ "status": "CANCELLED" }`** (only allowed value). Applies while status is **QUOTE**, **PENDING_PAYMENT**, or **CONFIRMED**, with no **`paidAt`** and no Stripe deposit hold in **PENDING** / **UNCAPTURED** / **CAPTURED**. **Idempotent** if already **CANCELLED**. When a webhook is configured on the key, enqueues **`reservation.cancelled`** (same **`X-Partner-Event`** / HMAC delivery as **`reservation.created`**).',
  })
  cancelPartnerReservation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @PartnerCtx() partner: PartnerRequestContext,
    @Req() req: Request,
  ) {
    partnerCancelReservationBodySchema.parse(body);
    return this.reservations.cancelForPartner(id, {
      companyId: partner.companyId,
      partnerApiKeyId: partner.partnerApiKeyId,
      ip: req.ip || undefined,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });
  }
}
