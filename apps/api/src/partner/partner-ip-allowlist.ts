/**
 * G2 (depth): optional IPv4 allowlist for `PartnerKeyGuard` when `PARTNER_API_ALLOWED_IP_CIDRS` and/or per-key `PartnerApiKey.allowedIpCidrs` is set (both apply — AND — when non-empty).
 * Supports single IPs (`203.0.113.10`) and CIDR (`10.0.0.0/8`). IPv6 is not matched (deny when allowlist active).
 */

export type ParsedAllowRule = { kind: 'ip4'; addr: number } | { kind: 'cidr4'; network: number; mask: number };

function ipv4ToInt(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) {
    return null;
  }
  const p = [m[1], m[2], m[3], m[4]].map((x) => parseInt(x!, 10));
  if (p.some((n) => n > 255 || n < 0)) {
    return null;
  }
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

/** Strip IPv4-mapped IPv6 prefix Express may emit. */
export function normalizePartnerClientIp(ip: string | undefined): string {
  if (!ip) {
    return '';
  }
  const t = ip.trim();
  if (t.startsWith('::ffff:')) {
    return t.slice(7);
  }
  return t;
}

export function parsePartnerIpAllowlist(raw: string | undefined): ParsedAllowRule[] {
  const s = raw?.trim();
  if (!s) {
    return [];
  }
  const out: ParsedAllowRule[] = [];
  for (const token of s.split(',')) {
    const t = token.trim();
    if (!t) {
      continue;
    }
    if (t.includes('/')) {
      const [addrPart, prefixPart] = t.split('/', 2);
      const prefix = parseInt((prefixPart ?? '').trim(), 10);
      if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) {
        continue;
      }
      const ip = ipv4ToInt(addrPart!.trim());
      if (ip == null) {
        continue;
      }
      const mask =
        prefix === 0 ? 0 : (((0xffffffff << (32 - prefix)) >>> 0) as number);
      out.push({ kind: 'cidr4', network: ip & mask, mask });
      continue;
    }
    const ip = ipv4ToInt(t);
    if (ip != null) {
      out.push({ kind: 'ip4', addr: ip });
    }
  }
  return out;
}

export function partnerClientIpAllowed(clientIp: string | undefined, rules: ParsedAllowRule[]): boolean {
  if (rules.length < 1) {
    return true;
  }
  const n = normalizePartnerClientIp(clientIp);
  const ip = ipv4ToInt(n);
  if (ip == null) {
    return false;
  }
  for (const r of rules) {
    if (r.kind === 'ip4' && r.addr === ip) {
      return true;
    }
    if (r.kind === 'cidr4' && (ip & r.mask) === r.network) {
      return true;
    }
  }
  return false;
}
