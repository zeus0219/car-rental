'use client';

import { useState } from 'react';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { formatDeskReservationStatus } from '../lib/desk-reservation-status-label';
import {
  getReservationNextActions,
  type ReservationNextAction,
} from '../lib/reservation-status-actions';

type Props = {
  reservationId: string;
  status: string;
  disabled?: boolean;
  onDone: () => void;
  onError: (message: string) => void;
};

export function ReservationStatusActions({
  reservationId,
  status,
  disabled,
  onDone,
  onError,
}: Props) {
  const { t } = usePublicLocaleContext();
  const [applying, setApplying] = useState<string | null>(null);
  const actions = getReservationNextActions(status);
  if (actions.length === 0) {
    return null;
  }

  function confirmLabel(a: ReservationNextAction): string {
    const statusLabel = formatDeskReservationStatus(a.next, t);
    return t('desk.reservations.quick.confirmSetStatus').replace('{status}', statusLabel);
  }

  async function apply(next: ReservationNextAction) {
    if (next.danger && !window.confirm(confirmLabel(next))) {
      return;
    }
    setApplying(next.next);
    try {
      await apiJson(`/reservations/${reservationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next.next }),
      });
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : t('desk.reservations.quick.errRequest'));
    } finally {
      setApplying(null);
    }
  }

  return (
    <div
      className="desk-table-actions"
      style={{ maxWidth: '16rem' }}
      role="group"
      aria-label={t('desk.reservations.quick.aria')}
    >
      {actions.map((a) => (
        <button
          key={a.next}
          type="button"
          disabled={disabled || applying !== null}
          title={a.danger ? t('desk.reservations.quick.dangerTitle') : undefined}
          onClick={() => {
            void apply(a);
          }}
        >
          {applying === a.next ? t('desk.ui.buttonBusy') : t(a.labelKey)}
        </button>
      ))}
    </div>
  );
}
