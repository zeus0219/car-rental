/** Format: `crtp_<uuid>_<32 hex secret>` (case-insensitive UUID). */
const PARTNER_KEY_RE =
  /^crtp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{32})$/i;

export function parsePartnerKeyRaw(raw: string): { id: string } | null {
  const m = raw.trim().match(PARTNER_KEY_RE);
  if (!m) {
    return null;
  }
  return { id: m[1]!.toLowerCase() };
}
