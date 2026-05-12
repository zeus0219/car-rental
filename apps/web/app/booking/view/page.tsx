'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { fetchPublicJson, getPublicApiBase, postPublicJson } from '../../../lib/public-api';
import {
  bookingViewNextSteps,
  describeDepositHoldForGuest,
  describePublicReservationStatus,
  statusBannerStyle,
} from '../../../lib/public-reservation-status';
import type { PublicLocale } from '../../../lib/public-locale';

type PublicBookingView = {
  id: string;
  companyId: string;
  status: string;
  companyName: string;
  vehicleClass: { name: string; code: string };
  pickupAt: string;
  returnAt: string;
  pickupStation: { id: string; name: string; code: string; city: string; province: string };
  returnStation: { id: string; name: string; code: string; city: string; province: string };
  totalCents: number | null;
  currency: string;
  customerName: string;
  paidAt: string | null;
  depositHoldStatus: string;
  depositHoldCents: number | null;
  extraLines?: { label: string; amountCents: number }[];
};

function formatWhen(iso: string, locale: PublicLocale) {
  try {
    const loc = locale === 'it' ? 'it-IT' : 'en-GB';
    return new Date(iso).toLocaleString(loc, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function fmtMoney(cents: number | null | undefined, currency: string, locale: PublicLocale): string {
  if (cents == null) {
    return '—';
  }
  const major = cents / 100;
  const c = (currency || 'EUR').toUpperCase();
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency: c }).format(major);
  } catch {
    const sym = c === 'EUR' ? '€' : `${c} `;
    return `${sym}${major.toFixed(2)}`;
  }
}

function ViewContent() {
  const { t, locale } = usePublicLocaleContext();
  const searchParams = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const magic = searchParams.get('magic')?.trim() ?? '';
  const [data, setData] = useState<PublicBookingView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!(token === '' && magic === ''));
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverRef, setRecoverRef] = useState('');
  const [recoverPhase, setRecoverPhase] = useState<'idle' | 'sending' | 'done' | 'err'>('idle');

  useEffect(() => {
    if (magic) {
      setErr(null);
      setLoading(true);
      void (async () => {
        try {
          const q = `/public/reservations/by-view-token?magic=${encodeURIComponent(magic)}`;
          const out = await fetchPublicJson<PublicBookingView>(q);
          setData(out);
        } catch {
          setData(null);
          setErr(t('booking.err.load'));
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    if (token) {
      if (!/^[a-f0-9]+$/i.test(token) || token.length < 32) {
        setErr(t('booking.err.badToken'));
        setLoading(false);
        return;
      }
      void (async () => {
        setErr(null);
        setLoading(true);
        try {
          const q = `/public/reservations/by-view-token?token=${encodeURIComponent(token)}`;
          const out = await fetchPublicJson<PublicBookingView>(q);
          setData(out);
        } catch {
          setData(null);
          setErr(t('booking.err.load'));
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    setLoading(false);
    setData(null);
    setErr(null);
  }, [token, magic, t]);

  async function submitRecover() {
    const em = recoverEmail.trim();
    const rid = recoverRef.trim();
    if (!em.includes('@') || !/^[0-9a-f-]{36}$/i.test(rid)) {
      setRecoverPhase('err');
      return;
    }
    setRecoverPhase('sending');
    setErr(null);
    try {
      await postPublicJson<{ ok: true }>('/public/reservations/request-view-link', {
        reservationId: rid,
        customerEmail: em,
      });
      setRecoverPhase('done');
    } catch {
      setRecoverPhase('err');
    }
  }

  async function copyViewLink() {
    if (typeof window === 'undefined') {
      return;
    }
    const url = token
      ? `${window.location.origin}/booking/view?token=${encodeURIComponent(token)}`
      : `${window.location.origin}/booking/view?magic=${encodeURIComponent(magic)}`;
    if (!token && !magic) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('ok');
      setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('err');
      setTimeout(() => setCopyState('idle'), 4000);
    }
  }

  if (!token && !magic) {
    return (
      <div className="desk-form desk-form-panel" style={{ maxWidth: 440 }}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('booking.recover.heading')}</h2>
        <p className="desk-muted" style={{ marginTop: 0 }}>
          {t('booking.recover.blurb')}
        </p>
        <label>
          {t('booking.recover.email')}
          <input
            type="email"
            value={recoverEmail}
            onChange={(e) => {
              setRecoverEmail(e.target.value);
              setRecoverPhase('idle');
            }}
            autoComplete="email"
          />
        </label>
        <label>
          {t('booking.recover.ref')}
          <input
            value={recoverRef}
            onChange={(e) => {
              setRecoverRef(e.target.value);
              setRecoverPhase('idle');
            }}
            spellCheck={false}
            placeholder={t('form.placeholder.uuid')}
          />
        </label>
        <div className="desk-form-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => void submitRecover()}
            disabled={recoverPhase === 'sending'}
          >
            {recoverPhase === 'sending' ? t('booking.recover.sending') : t('booking.recover.submit')}
          </button>
        </div>
        {recoverPhase === 'done' && <p className="desk-ok">{t('booking.recover.done')}</p>}
        {recoverPhase === 'err' && <p className="desk-err">{t('booking.recover.err')}</p>}
      </div>
    );
  }

  if (loading) {
    return <p>{t('booking.loading')}</p>;
  }

  if (err) {
    return (
      <div>
        <p className="desk-err" role="status">
          {err}
        </p>
        <div className="desk-form desk-form-panel" style={{ maxWidth: 440, marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('booking.recover.heading')}</h2>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            {t('booking.recover.blurb')}
          </p>
          <label>
            {t('booking.recover.email')}
            <input
              type="email"
              value={recoverEmail}
              onChange={(e) => {
                setRecoverEmail(e.target.value);
                setRecoverPhase('idle');
              }}
              autoComplete="email"
            />
          </label>
          <label>
            {t('booking.recover.ref')}
            <input
              value={recoverRef}
              onChange={(e) => {
                setRecoverRef(e.target.value);
                setRecoverPhase('idle');
              }}
              spellCheck={false}
              placeholder={t('form.placeholder.uuid')}
            />
          </label>
          <div className="desk-form-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => void submitRecover()}
              disabled={recoverPhase === 'sending'}
            >
              {recoverPhase === 'sending' ? t('booking.recover.sending') : t('booking.recover.submit')}
            </button>
          </div>
          {recoverPhase === 'done' && <p className="desk-ok">{t('booking.recover.done')}</p>}
          {recoverPhase === 'err' && <p className="desk-err">{t('booking.recover.err')}</p>}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="desk-err">{t('booking.empty')}</p>;
  }

  const st = describePublicReservationStatus(data.status, locale);
  const nextSteps = bookingViewNextSteps(locale, { status: data.status, paidAt: data.paidAt });
  const quoteHref =
    data.companyId && /^[0-9a-f-]{36}$/i.test(data.companyId)
      ? `/quote?companyId=${encodeURIComponent(data.companyId)}`
      : '/quote';

  return (
    <div>
      <div style={statusBannerStyle(st.tone)}>
        <strong style={{ display: 'block', marginBottom: 4 }}>{st.label}</strong>
        {st.summary}
      </div>

      <div className="desk-tool" style={{ marginTop: '0.85rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void copyViewLink()} style={{ fontSize: '0.88rem' }}>
          {copyState === 'ok' ? t('booking.copy.ok') : copyState === 'err' ? t('booking.copy.err') : t('booking.copy.idle')}
        </button>
        <Link href={quoteHref} style={{ fontSize: '0.88rem' }}>
          {t('booking.openQuote')}
        </Link>
      </div>

      {nextSteps.length > 0 && (
        <div style={{ ...statusBannerStyle('muted'), marginTop: '0.75rem' }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>{t('booking.whatNext')}</strong>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {nextSteps.map((s) => (
              <li key={s.slice(0, 48)}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="desk-muted" style={{ marginTop: '0.75rem' }}>
        {data.companyName} — {t('booking.refLabel')} <code>{data.id}</code>
      </p>
      <h2 style={{ fontSize: '1.05rem', margin: '0.75rem 0' }}>{t('booking.trip')}</h2>
      <ul style={{ lineHeight: 1.6 }}>
        <li>
            <strong>{t('booking.pickup')}</strong> {formatWhen(data.pickupAt, locale)} — {data.pickupStation.name} ({data.pickupStation.city},{' '}
          {data.pickupStation.province})
        </li>
        <li>
          <strong>{t('booking.return')}</strong> {formatWhen(data.returnAt, locale)} — {data.returnStation.name} ({data.returnStation.city},{' '}
          {data.returnStation.province})
        </li>
        <li>
          <strong>{t('booking.class')}</strong> {data.vehicleClass.name} ({data.vehicleClass.code})
        </li>
        <li>
          <strong>{t('booking.systemStatus')}</strong>{' '}
          <span title={data.status}>{st.label}</span>
        </li>
        {data.totalCents != null && (
          <li>
            <strong>{t('booking.indicativeRent')}</strong> {fmtMoney(data.totalCents, data.currency, locale)}
          </li>
        )}
        {data.extraLines && data.extraLines.length > 0 && (
          <li style={{ display: 'block' }}>
            <strong>{t('booking.extras.heading')}</strong>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem', listStyle: 'disc' }}>
              {data.extraLines.map((e, i) => (
                <li key={`${e.label}-${i}`}>
                  {e.label} — {fmtMoney(e.amountCents, data.currency, locale)}
                </li>
              ))}
            </ul>
            {data.totalCents != null && (
              <p className="desk-muted" style={{ fontSize: '0.88rem', margin: '0.35rem 0 0' }}>
                {t('booking.extras.inTotal')}
              </p>
            )}
          </li>
        )}
        <li>
          <strong>{t('booking.leadGuest')}</strong> {data.customerName}
        </li>
        {data.paidAt && (
          <li className="desk-ok">
            <strong>{t('booking.rentPaid')}</strong> {t('booking.rentPaidRecorded')} — {formatWhen(data.paidAt, locale)}
          </li>
        )}
        <li>
          <strong>{t('booking.deposit')}</strong>{' '}
          {data.depositHoldStatus === 'NONE'
            ? describeDepositHoldForGuest('NONE', locale)
            : `${describeDepositHoldForGuest(data.depositHoldStatus, locale)}${
                data.depositHoldCents != null && data.depositHoldCents > 0
                  ? ` (${fmtMoney(data.depositHoldCents, data.currency, locale)})`
                  : ''
              }`}
        </li>
      </ul>
    </div>
  );
}

export default function PublicBookingViewPage() {
  const { t } = usePublicLocaleContext();
  return (
    <main className="public-page">
      <h1 style={{ marginTop: 0 }}>{t('booking.title')}</h1>
      <p className="desk-muted" style={{ marginTop: 0, fontSize: '0.88rem' }}>
        {t('booking.intro')} <code>{getPublicApiBase()}</code>
      </p>
      <p>
        <Link href="/">{t('booking.nav.home')}</Link> · <Link href="/quote">{t('booking.nav.quote')}</Link> ·{' '}
        <Link href="/auth">{t('booking.nav.staff')}</Link>
      </p>
      <section style={{ marginTop: '1.25rem' }}>
        <Suspense fallback={<p>{t('booking.loading')}</p>}>
          <ViewContent />
        </Suspense>
      </section>
    </main>
  );
}
