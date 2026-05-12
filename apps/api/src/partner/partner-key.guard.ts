import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { parsePartnerIpAllowlist, partnerClientIpAllowed } from './partner-ip-allowlist';
import { parsePartnerKeyRaw } from './parse-partner-key';
import { assertPartnerMtlsIfRequired } from './partner-mtls';
import { PartnerOauthService } from './partner-oauth.service';
import type { RequestWithPartner } from './partner.types';

@Injectable()
export class PartnerKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly partnerOauth: PartnerOauthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPartner>();
    assertPartnerMtlsIfRequired(this.config, req);

    const bearer = this.extractBearer(req);
    if (bearer && this.looksLikeJwt(bearer)) {
      const payload = await this.partnerOauth.verifyAccessToken(bearer);
      const row = await this.prisma.partnerApiKey.findFirst({
        where: { id: payload.sub, revokedAt: null },
      });
      if (!row) {
        throw new UnauthorizedException('Invalid partner access token');
      }
      if (row.companyId !== payload.companyId) {
        throw new UnauthorizedException('Invalid partner access token');
      }
      this.assertIpv4Allowlist(
        req.ip,
        this.config.get<string>('PARTNER_API_ALLOWED_IP_CIDRS'),
        'Partner API IP allowlist has no valid IPv4 entries',
      );
      this.assertIpv4Allowlist(
        req.ip,
        row.allowedIpCidrs ?? undefined,
        'Partner API key IP allowlist has no valid IPv4 entries',
      );
      void this.prisma.partnerApiKey
        .update({
          where: { id: row.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
      req.partner = { partnerApiKeyId: row.id, companyId: row.companyId };
      return true;
    }

    let raw: string | null = null;
    if (typeof req.headers['x-partner-key'] === 'string' && req.headers['x-partner-key'].trim()) {
      raw = req.headers['x-partner-key'].trim();
    } else if (bearer && bearer.toLowerCase().startsWith('crtp_')) {
      raw = bearer;
    }

    if (!raw) {
      throw new UnauthorizedException('Partner API key or OAuth access token required');
    }
    const parsed = parsePartnerKeyRaw(raw);
    if (!parsed) {
      throw new UnauthorizedException('Invalid partner API key');
    }
    const row = await this.prisma.partnerApiKey.findFirst({
      where: { id: parsed.id, revokedAt: null },
    });
    if (!row) {
      throw new UnauthorizedException('Invalid partner API key');
    }
    const ok = await bcrypt.compare(raw.trim(), row.keyHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid partner API key');
    }
    this.assertIpv4Allowlist(
      req.ip,
      this.config.get<string>('PARTNER_API_ALLOWED_IP_CIDRS'),
      'Partner API IP allowlist has no valid IPv4 entries',
    );
    this.assertIpv4Allowlist(
      req.ip,
      row.allowedIpCidrs ?? undefined,
      'Partner API key IP allowlist has no valid IPv4 entries',
    );
    void this.prisma.partnerApiKey
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
    req.partner = { partnerApiKeyId: row.id, companyId: row.companyId };
    return true;
  }

  private extractBearer(req: RequestWithPartner): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const t = auth.slice(7).trim();
      return t || null;
    }
    return null;
  }

  private looksLikeJwt(token: string): boolean {
    const parts = token.split('.');
    return parts.length === 3 && parts.every((p) => p.length > 0);
  }

  /** When `raw` is non-empty, client IP must match parsed IPv4 rules (AND with any other active allowlist). */
  private assertIpv4Allowlist(
    reqIp: string | undefined,
    raw: string | null | undefined,
    invalidConfigMessage: string,
  ): void {
    const s = raw?.trim() ?? '';
    if (!s) {
      return;
    }
    const rules = parsePartnerIpAllowlist(s);
    if (rules.length === 0) {
      throw new ForbiddenException(invalidConfigMessage);
    }
    if (!partnerClientIpAllowed(reqIp, rules)) {
      throw new ForbiddenException('Partner API access denied for this IP address');
    }
  }
}
