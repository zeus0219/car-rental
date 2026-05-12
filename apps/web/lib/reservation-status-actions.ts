import { reservationStatusValues } from '@car-rental/shared';

export type ReservationStatus = (typeof reservationStatusValues)[number];

/** Keys in `public-messages` under `desk.reservations.quick.*` */
export type ReservationQuickLabelKey =
  | 'desk.reservations.quick.confirm'
  | 'desk.reservations.quick.pendingPayment'
  | 'desk.reservations.quick.cancel'
  | 'desk.reservations.quick.confirmPaid'
  | 'desk.reservations.quick.startRental'
  | 'desk.reservations.quick.complete'
  | 'desk.reservations.quick.noShow';

export type ReservationNextAction = {
  labelKey: ReservationQuickLabelKey;
  next: ReservationStatus;
  /** Show confirm before PATCH */
  danger?: boolean;
};

/**
 * v1 desk workflow: conservative next steps. Terminal rows have no actions here
 * (staff can still use Edit to change fields or set status manually).
 */
export function getReservationNextActions(status: string): ReservationNextAction[] {
  switch (status) {
    case 'QUOTE':
      return [
        { labelKey: 'desk.reservations.quick.confirm', next: 'CONFIRMED' },
        { labelKey: 'desk.reservations.quick.pendingPayment', next: 'PENDING_PAYMENT' },
        { labelKey: 'desk.reservations.quick.cancel', next: 'CANCELLED', danger: true },
      ];
    case 'PENDING_PAYMENT':
      return [
        { labelKey: 'desk.reservations.quick.confirmPaid', next: 'CONFIRMED' },
        { labelKey: 'desk.reservations.quick.cancel', next: 'CANCELLED', danger: true },
      ];
    case 'CONFIRMED':
      return [
        { labelKey: 'desk.reservations.quick.startRental', next: 'IN_PROGRESS' },
        { labelKey: 'desk.reservations.quick.cancel', next: 'CANCELLED', danger: true },
      ];
    case 'IN_PROGRESS':
      return [
        { labelKey: 'desk.reservations.quick.complete', next: 'COMPLETED' },
        { labelKey: 'desk.reservations.quick.noShow', next: 'NO_SHOW', danger: true },
      ];
    default:
      return [];
  }
}
