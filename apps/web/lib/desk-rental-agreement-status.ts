import type { PublicMessageKey } from './public-messages';

export const RENTAL_AGREEMENT_STATUS_KEYS: Record<string, PublicMessageKey> = {
  DRAFT: 'desk.reservations.agreement.status.DRAFT',
  SIGNED: 'desk.reservations.agreement.status.SIGNED',
  VOID: 'desk.reservations.agreement.status.VOID',
};

export function formatRentalAgreementStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = RENTAL_AGREEMENT_STATUS_KEYS[status];
  return key ? t(key) : status;
}
