import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

function truthyEnv(raw: string | undefined): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * G2: mutual TLS is usually terminated at the edge (nginx, ALB). Require a header the edge sets when
 * `ssl_client_verify` (or equivalent) succeeded. See `PARTNER_MTLS_*` env and PRODUCTION.md.
 */
export function assertPartnerMtlsIfRequired(config: ConfigService, req: Request): void {
  if (!truthyEnv(config.get<string>('PARTNER_MTLS_REQUIRE'))) {
    return;
  }
  const nameRaw = config.get<string>('PARTNER_MTLS_VERIFIED_HEADER_NAME')?.trim() || 'X-Client-Cert-Verified';
  const headerName = nameRaw.toLowerCase();
  const expected = (config.get<string>('PARTNER_MTLS_VERIFIED_HEADER_VALUE')?.trim() || 'SUCCESS').trim();
  const raw = req.headers[headerName];
  const v =
    typeof raw === 'string' ? raw.trim() : Array.isArray(raw) && raw[0] ? String(raw[0]).trim() : '';
  if (v !== expected) {
    throw new ForbiddenException(
      'Partner API requires mutual TLS — client certificate was not verified at the edge',
    );
  }
}
