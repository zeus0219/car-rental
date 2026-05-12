/** Human-friendly copy for public web (quote + view-token) — keep in sync with `ReservationStatus` in API. */

import type { CSSProperties } from 'react';
import type { PublicLocale } from './public-locale';
import { publicT, type PublicMessageKey } from './public-messages';

export type PublicStatusTone = 'muted' | 'info' | 'success' | 'warn' | 'err';

const STATUS_COPY: Record<
  string,
  { label: PublicMessageKey; summary: PublicMessageKey; tone: PublicStatusTone }
> = {
  QUOTE: {
    label: 'status.quote.label',
    summary: 'status.quote.summary',
    tone: 'info',
  },
  PENDING_PAYMENT: {
    label: 'status.pendingPayment.label',
    summary: 'status.pendingPayment.summary',
    tone: 'warn',
  },
  CONFIRMED: {
    label: 'status.confirmed.label',
    summary: 'status.confirmed.summary',
    tone: 'success',
  },
  IN_PROGRESS: {
    label: 'status.inProgress.label',
    summary: 'status.inProgress.summary',
    tone: 'success',
  },
  COMPLETED: {
    label: 'status.completed.label',
    summary: 'status.completed.summary',
    tone: 'muted',
  },
  NO_SHOW: {
    label: 'status.noShow.label',
    summary: 'status.noShow.summary',
    tone: 'err',
  },
  CANCELLED: {
    label: 'status.cancelled.label',
    summary: 'status.cancelled.summary',
    tone: 'muted',
  },
};

export function describePublicReservationStatus(
  status: string,
  locale: PublicLocale,
): {
  label: string;
  summary: string;
  tone: PublicStatusTone;
} {
  const row = STATUS_COPY[status];
  if (row) {
    return {
      label: publicT(locale, row.label),
      summary: publicT(locale, row.summary),
      tone: row.tone,
    };
  }
  return {
    label: status,
    summary: publicT(locale, 'status.unknown.summary'),
    tone: 'muted',
  };
}

/** Whether the API allows `POST …/public/reservations/:id/rental-checkout`. */
export function canOfferPublicRentCheckout(
  status: string,
  totalCents: number | null | undefined,
): boolean {
  if (totalCents == null || totalCents < 1) {
    return false;
  }
  return status === 'QUOTE' || status === 'PENDING_PAYMENT';
}

const DEPOSIT_COPY: Record<string, PublicMessageKey> = {
  NONE: 'deposit.none',
  PENDING: 'deposit.pending',
  UNCAPTURED: 'deposit.uncaptured',
  CAPTURED: 'deposit.captured',
  CANCELED: 'deposit.canceled',
  FAILED: 'deposit.failed',
};

/** Guest-facing line for `DepositHoldStatus` (API / Prisma enum). */
export function describeDepositHoldForGuest(status: string, locale: PublicLocale): string {
  const key = DEPOSIT_COPY[status];
  return key ? publicT(locale, key) : status;
}

/** Short bullets for `/booking/view` (magic link) — no account. */
export function bookingViewNextSteps(
  locale: PublicLocale,
  p: { status: string; paidAt: string | null },
): string[] {
  const out: string[] = [];
  const unpaidQuote = (p.status === 'QUOTE' || p.status === 'PENDING_PAYMENT') && !p.paidAt;
  if (unpaidQuote) {
    out.push(publicT(locale, 'booking.next.unpaidPayCard'));
    out.push(publicT(locale, 'booking.next.unpaidBookmark'));
  }
  if (p.status === 'CONFIRMED' && p.paidAt) {
    out.push(publicT(locale, 'booking.next.confirmedPickup'));
  }
  if (p.status === 'IN_PROGRESS') {
    out.push(publicT(locale, 'booking.next.inProgress'));
  }
  if (p.status === 'CANCELLED' || p.status === 'NO_SHOW') {
    out.push(publicT(locale, 'booking.next.cancelledContact'));
  }
  return out;
}

export function statusBannerStyle(tone: PublicStatusTone): CSSProperties {
  const base: CSSProperties = {
    marginTop: 0,
    marginBottom: 0,
    padding: '0.75rem 1rem',
    borderRadius: 8,
    border: '1px solid',
    fontSize: '0.92rem',
    lineHeight: 1.45,
  };
  switch (tone) {
    case 'success':
      return {
        ...base,
        background: '#ecfdf5',
        borderColor: '#6ee7b7',
        color: '#065f46',
      };
    case 'info':
      return {
        ...base,
        background: '#eff6ff',
        borderColor: '#93c5fd',
        color: '#1e3a8a',
      };
    case 'warn':
      return {
        ...base,
        background: '#fffbeb',
        borderColor: '#fcd34d',
        color: '#92400e',
      };
    case 'err':
      return {
        ...base,
        background: '#fef2f2',
        borderColor: '#fecaca',
        color: '#991b1b',
      };
    default:
      return {
        ...base,
        background: '#f8fafc',
        borderColor: '#e2e8f0',
        color: '#475569',
      };
  }
}
