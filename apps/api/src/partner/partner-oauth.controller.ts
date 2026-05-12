import { Body, Controller, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { assertPartnerMtlsIfRequired } from './partner-mtls';
import { PartnerOauthService } from './partner-oauth.service';

@ApiTags('Partner')
@Public()
@Controller('partner/oauth')
export class PartnerOauthController {
  constructor(
    private readonly oauth: PartnerOauthService,
    private readonly config: ConfigService,
  ) {}

  @Post('token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'OAuth2 client_credentials — obtain a short-lived partner access token',
    description:
      'JSON body: `{ "grant_type": "client_credentials", "client_id": "<PartnerApiKey id>", "client_secret": "<secret from desk>" }`. ' +
      'Returns `{ access_token, token_type: \"Bearer\", expires_in }`. Use **`Authorization: Bearer &lt;access_token&gt;`** on **`/v1/partner/*`** (same as legacy **`crtp_…`** key). ' +
      'Requires **OAuth credentials** generated in desk for that key. When **`PARTNER_MTLS_REQUIRE`** is set, the edge must pass mTLS verification headers.',
  })
  async token(@Req() req: Request, @Body() body: unknown) {
    assertPartnerMtlsIfRequired(this.config, req);
    return this.oauth.issueToken(body);
  }
}
