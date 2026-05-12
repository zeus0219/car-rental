import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { partnerOAuthTokenRequestSchema } from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';

export const PARTNER_JWT_PUR = 'partner_api' as const;

export type PartnerAccessJwtPayload = {
  sub: string;
  companyId: string;
  pur: typeof PARTNER_JWT_PUR;
  iat?: number;
  exp?: number;
};

@Injectable()
export class PartnerOauthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private oauthSigningSecret(): string {
    const dedicated = this.config.get<string>('PARTNER_OAUTH_JWT_SECRET')?.trim();
    if (dedicated) {
      return dedicated;
    }
    return this.config.get<string>('JWT_SECRET') ?? 'dev-insecure-jwt-secret-change-in-env';
  }

  private accessTokenTtlSec(): number {
    const raw = this.config.get<string | number>('PARTNER_OAUTH_ACCESS_TOKEN_TTL_SEC');
    const n = raw === undefined || raw === '' ? 3600 : parseInt(String(raw), 10);
    if (!Number.isFinite(n)) {
      return 3600;
    }
    return Math.min(24 * 3600, Math.max(300, n));
  }

  async issueToken(body: unknown): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
  }> {
    const parsed = partnerOAuthTokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid token request');
    }
    const { client_id: clientId, client_secret: clientSecret } = parsed.data;
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: clientId, revokedAt: null },
      select: { id: true, companyId: true, oauthClientSecretHash: true },
    });
    if (!row?.oauthClientSecretHash) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    const ok = await bcrypt.compare(clientSecret.trim(), row.oauthClientSecretHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    const expiresIn = this.accessTokenTtlSec();
    const payload: PartnerAccessJwtPayload = {
      sub: row.id,
      companyId: row.companyId,
      pur: PARTNER_JWT_PUR,
    };
    const access_token = await this.jwt.signAsync(payload, {
      secret: this.oauthSigningSecret(),
      expiresIn,
    });
    void this.prisma.partnerApiKey
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
    return { access_token, token_type: 'Bearer', expires_in: expiresIn };
  }

  async verifyAccessToken(token: string): Promise<PartnerAccessJwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<PartnerAccessJwtPayload>(token, {
        secret: this.oauthSigningSecret(),
      });
      if (
        !payload ||
        payload.pur !== PARTNER_JWT_PUR ||
        typeof payload.sub !== 'string' ||
        typeof payload.companyId !== 'string'
      ) {
        throw new UnauthorizedException('Invalid partner access token');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid partner access token');
    }
  }
}
