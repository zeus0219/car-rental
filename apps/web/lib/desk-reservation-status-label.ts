import { reservationStatusValues } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

export function formatDeskReservationStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  if ((reservationStatusValues as readonly string[]).includes(status)) {
    return t(`desk.reservations.status.${status}` as PublicMessageKey);
  }
  return status;
}
