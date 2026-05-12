import { reservationStatusValues } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

/** Report breakdown copy (`desk.reports.enum.reservation.*`) — not always identical to `desk.reservations.status.*`. */
export function formatDeskReportReservationStatus(
  status: string,
  t: (key: PublicMessageKey) => string,
): string {
  if ((reservationStatusValues as readonly string[]).includes(status)) {
    return t(`desk.reports.enum.reservation.${status}` as PublicMessageKey);
  }
  return status;
}
