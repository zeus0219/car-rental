import type { PublicMessageKey } from './public-messages';

const BLOCK_TYPE_KEYS: Record<string, PublicMessageKey> = {
  MAINTENANCE: 'desk.calendar.blockType.MAINTENANCE',
  BUFFER: 'desk.calendar.blockType.BUFFER',
  HOLD: 'desk.calendar.blockType.HOLD',
  OTHER: 'desk.calendar.blockType.OTHER',
};

export function formatDeskCalendarBlockType(
  type: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = BLOCK_TYPE_KEYS[type];
  return key ? t(key) : type;
}
