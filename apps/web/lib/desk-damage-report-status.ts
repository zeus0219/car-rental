import type { PublicMessageKey } from './public-messages';

const DAMAGE_REPORT_STATUS_KEYS: Record<string, PublicMessageKey> = {
  DRAFT: 'desk.reservations.damage.status.DRAFT',
  CLOSED: 'desk.reservations.damage.status.CLOSED',
};

export function formatDamageReportStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = DAMAGE_REPORT_STATUS_KEYS[status];
  return key ? t(key) : status;
}
