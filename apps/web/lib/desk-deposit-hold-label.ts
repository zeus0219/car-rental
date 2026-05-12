import type { PublicMessageKey } from './public-messages';

export const DEPOSIT_HOLD_STATUS_KEYS: Record<string, PublicMessageKey> = {
  NONE: 'desk.reconciliation.depositHold.NONE',
  PENDING: 'desk.reconciliation.depositHold.PENDING',
  UNCAPTURED: 'desk.reconciliation.depositHold.UNCAPTURED',
  CAPTURED: 'desk.reconciliation.depositHold.CAPTURED',
  CANCELED: 'desk.reconciliation.depositHold.CANCELED',
  FAILED: 'desk.reconciliation.depositHold.FAILED',
};

export function formatDepositHoldStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = DEPOSIT_HOLD_STATUS_KEYS[status];
  return key ? t(key) : status;
}
