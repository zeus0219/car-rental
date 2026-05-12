import { reservationSourceValues } from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

export type DeskReservationSourceDisplay = {
  label: string;
  title?: string;
  /** Muted styling for web/partner (and unknown API values). */
  muted: boolean;
  /** When true, render label in <code> (unknown bucket in reports). */
  displayAsCode?: boolean;
};

export type DeskReservationSourceContext = 'reservations' | 'reconciliation' | 'reports';

export function formatDeskReservationSource(
  source: string | null | undefined,
  t: (key: PublicMessageKey) => string,
  opts?: { context?: DeskReservationSourceContext },
): DeskReservationSourceDisplay {
  const s = source ?? 'STAFF';
  const context = opts?.context ?? 'reservations';

  if (context === 'reports') {
    if ((reservationSourceValues as readonly string[]).includes(s)) {
      return {
        label: t(`desk.reports.enum.source.${s}` as PublicMessageKey),
        muted: false,
      };
    }
    return { label: s, title: s, muted: true, displayAsCode: true };
  }

  if (context === 'reconciliation') {
    if (s === 'PUBLIC_WEB') {
      return { label: t('desk.reconciliation.source.publicWeb'), muted: true };
    }
    if (s === 'PARTNER') {
      return { label: t('desk.reconciliation.source.partner'), muted: true };
    }
    if (s === 'STAFF') {
      return { label: t('desk.reconciliation.source.staff'), muted: false };
    }
    return { label: s, title: s, muted: true };
  }

  if (s === 'PUBLIC_WEB') {
    return {
      label: t('desk.reservations.source.webLabel'),
      title: t('desk.reservations.source.webTitle'),
      muted: true,
    };
  }
  if (s === 'PARTNER') {
    return {
      label: t('desk.reservations.source.partnerLabel'),
      title: t('desk.reservations.source.partnerTitle'),
      muted: true,
    };
  }
  if (s === 'STAFF') {
    return {
      label: t('desk.reservations.source.deskLabel'),
      muted: false,
    };
  }
  return { label: s, title: s, muted: true };
}
