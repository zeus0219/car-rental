import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { PartnerWebhookDeliveryStatus } from '@prisma/client';
import {
  createPartnerApiKeySchema,
  patchPartnerApiKeyAllowedIpCidrsSchema,
  patchPartnerApiKeyWebhookSchema,
} from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { assertSameCompany } from '../auth/company-access';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { PartnerApiKeyService } from './partner-api-key.service';

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('companies')
export class CompanyPartnerApiKeysController {
  constructor(private readonly partnerKeys: PartnerApiKeyService) {}

  @Get(':companyId/partner-webhook-deliveries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'READONLY_ACCOUNTING')
  @ApiOperation({
    summary: 'List outbound partner webhook deliveries for the company (read-only; G2)',
  })
  @ApiQuery({ name: 'status', required: false, description: 'PENDING | PROCESSING | SUCCEEDED | DEAD' })
  @ApiQuery({ name: 'limit', required: false, description: '1–100 (default 30)' })
  @ApiQuery({ name: 'offset', required: false, description: 'default 0' })
  async listWebhookDeliveries(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @CurrentUser() user: JwtUser,
    @Query('status') statusRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    const allowed: PartnerWebhookDeliveryStatus[] = [
      'PENDING',
      'PROCESSING',
      'SUCCEEDED',
      'DEAD',
    ];
    let status: PartnerWebhookDeliveryStatus | undefined;
    if (statusRaw?.trim()) {
      const s = statusRaw.trim().toUpperCase();
      if (!allowed.includes(s as PartnerWebhookDeliveryStatus)) {
        throw new BadRequestException(
          'Invalid status (use PENDING, PROCESSING, SUCCEEDED, or DEAD)',
        );
      }
      status = s as PartnerWebhookDeliveryStatus;
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? '30', 10) || 30));
    const offset = Math.max(0, Number.parseInt(offsetRaw ?? '0', 10) || 0);
    return this.partnerKeys.listWebhookDeliveries(companyId, { status, limit, offset });
  }

  @Get(':companyId/partner-api-keys')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'READONLY_ACCOUNTING')
  @ApiOperation({ summary: 'List partner API keys for a company (metadata only)' })
  list(@Param('companyId', new ParseUUIDPipe()) companyId: string, @CurrentUser() user: JwtUser) {
    assertSameCompany(user, companyId, 'Company not found');
    return this.partnerKeys.listForCompany(companyId).then((rows) =>
      rows.map((r) => ({
        ...r,
        maskedKey: `crtp_${r.id}_****`,
      })),
    );
  }

  @Post(':companyId/partner-api-keys')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiOperation({ summary: 'Create partner API key (plaintext shown once in `apiKey`)' })
  create(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    const data = createPartnerApiKeySchema.parse(body);
    return this.partnerKeys.create(companyId, data.name, user.sub);
  }

  @Delete(':companyId/partner-api-keys/:keyId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a partner API key' })
  async revoke(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @CurrentUser() user: JwtUser,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    await this.partnerKeys.revoke(companyId, keyId, user.sub);
  }

  @Patch(':companyId/partner-api-keys/:keyId/webhook')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiOperation({
    summary:
      'Update outbound webhook URL and/or signing secret (HMAC-SHA256 over JSON body); empty string clears',
  })
  async patchWebhook(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    const data = patchPartnerApiKeyWebhookSchema.parse(body);
    const meta = await this.partnerKeys.updateWebhook(companyId, keyId, data, user.sub);
    return { id: keyId, ...meta };
  }

  @Patch(':companyId/partner-api-keys/:keyId/allowed-ip-cidrs')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiOperation({
    summary:
      'G2 — optional per-key IPv4 allowlist (comma-separated IPs / CIDR); empty string clears; AND with env PARTNER_API_ALLOWED_IP_CIDRS when both set',
  })
  async patchAllowedIpCidrs(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    const data = patchPartnerApiKeyAllowedIpCidrsSchema.parse(body);
    return this.partnerKeys.updateAllowedIpCidrs(companyId, keyId, data, user.sub);
  }

  @Post(':companyId/partner-api-keys/:keyId/oauth-client-secret')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @ApiOperation({
    summary:
      'G2 — generate or rotate OAuth2 client_secret (plaintext once). Token: POST /v1/partner/oauth/token (client_credentials, client_id = key id)',
  })
  async postOauthClientSecret(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @CurrentUser() user: JwtUser,
  ) {
    assertSameCompany(user, companyId, 'Company not found');
    return this.partnerKeys.regenerateOauthClientSecret(companyId, keyId, user.sub);
  }
}
