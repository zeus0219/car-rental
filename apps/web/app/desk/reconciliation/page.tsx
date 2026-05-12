'use client';

import Link from 'next/link';
import { Suspense, useCallback, useMemo, useState } from 'react';
import type { ReconciliationResponse, ReconciliationRow } from '@car-rental/shared';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiFetch, apiJson } from '../../../lib/api';
import { formatDepositHoldStatus } from '../../../lib/desk-deposit-hold-label';
import { formatDeskReservationSource } from '../../../lib/desk-reservation-source-label';
import { formatDeskReservationStatus } from '../../../lib/desk-reservation-status-label';
import type { PublicLocale } from '../../../lib/public-locale';
import type { PublicMessageKey } from '../../../lib/public-messages';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

function monthBoundsIsoDate(): { from: string; to: string } {
  const n = new Date();
  const y = n.getFullYear();
  const m = n.getMonth();
  const pad = (x: number) => String(x).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
  };
}

function fmtMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) {
    return '—';
  }
  const major = cents / 100;
  const c = (currency || 'EUR').toUpperCase();
  const sym = c === 'EUR' ? '€' : `${c} `;
  return `${sym}${major.toFixed(2)}`;
}

function fmtShort(iso: string, locale: PublicLocale): string {
  const tag = locale === 'it' ? 'it-IT' : 'en-GB';
  try {
    return new Date(iso).toLocaleString(tag, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function shortenId(s: string | null | undefined, head = 14): string {
  if (!s) {
    return '—';
  }
  return s.length <= head ? s : `${s.slice(0, head)}…`;
}

function rowIntegrityFlags(r: ReconciliationRow, t: (key: PublicMessageKey) => string): string[] {
  const flags: string[] = [];
  if (r.paidAt && !r.stripeCheckoutSessionId) {
    flags.push(t('desk.reconciliation.flag.paidAtNoCheckout'));
  }
  if (r.depositHoldStatus !== 'NONE' && !r.stripeDepositCheckoutSessionId && !r.stripeDepositPaymentIntentId) {
    flags.push(t('desk.reconciliation.flag.depositNoStripe'));
  }
  return flags;
}

function formatRefundKind(
  kind: 'RENTAL' | 'DEPOSIT',
  t: (key: PublicMessageKey) => string,
): string {
  return kind === 'RENTAL' ? t('desk.reconciliation.refundKind.rental') : t('desk.reconciliation.refundKind.deposit');
}

function ReconciliationContent() {
  const { t, locale } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const defaults = useMemo(() => monthBoundsIsoDate(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [preview, setPreview] = useState<ReconciliationResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [matchFilter, setMatchFilter] = useState<'ALL' | ReconciliationRow['matchReason']>('ALL');

  const matchLabels = useMemo(
    () => ({
      BOTH: t('desk.reconciliation.match.both'),
      RENTAL_PAID_IN_WINDOW: t('desk.reconciliation.match.rentalPaid'),
      DEPOSIT_ACTIVITY_IN_WINDOW: t('desk.reconciliation.match.depositActivity'),
    }),
    [t],
  );

  const loadPreview = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({
        companyId,
        from,
        to,
        format: 'json',
      });
      const data = await apiJson<ReconciliationResponse>(`/payments/stripe/reconciliation?${q.toString()}`);
      setPreview(data);
    } catch (e) {
      setPreview(null);
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, from, to, t]);

  const downloadCsv = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setErr(null);
    try {
      const q = new URLSearchParams({
        companyId,
        from,
        to,
        format: 'csv',
      });
      const r = await apiFetch(`/payments/stripe/reconciliation?${q.toString()}`);
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stripe-reconciliation-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }, [companyId, from, to, t]);

  const stats = useMemo(() => {
    if (!preview) {
      return null;
    }
    const rows = preview.rows;
    const byReason: Record<ReconciliationRow['matchReason'], number> = {
      BOTH: 0,
      RENTAL_PAID_IN_WINDOW: 0,
      DEPOSIT_ACTIVITY_IN_WINDOW: 0,
    };
    let publicWeb = 0;
    let anomalyRows = 0;
    for (const r of rows) {
      byReason[r.matchReason]++;
      if (r.source === 'PUBLIC_WEB') {
        publicWeb++;
      }
      if (rowIntegrityFlags(r, t).length > 0) {
        anomalyRows++;
      }
    }
    return {
      byReason,
      publicWeb,
      staff: rows.length - publicWeb,
      anomalyRows,
    };
  }, [preview, t]);

  const displayRows = useMemo(() => {
    if (!preview) {
      return [];
    }
    if (matchFilter === 'ALL') {
      return preview.rows;
    }
    return preview.rows.filter((r) => r.matchReason === matchFilter);
  }, [preview, matchFilter]);

  if (meLoading) {
    return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  }
  if (meErr) {
    return <p className="desk-err">{meErr}</p>;
  }
  if (!me) {
    return null;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.reconciliation.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '48rem' }}>
        {t('desk.reconciliation.intro')}
      </p>
      <details
        className="desk-muted"
        style={{ marginTop: '0.65rem', fontSize: '0.82rem', maxWidth: '48rem' }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
          {t('desk.e5.summary')}
        </summary>
        <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.e5.lead')}</p>
        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
          <li>{t('desk.e5.item1')}</li>
          <li>{t('desk.e5.item2')}</li>
          <li>{t('desk.e5.item3')}</li>
          <li>{t('desk.e5.item4')}</li>
          <li>{t('desk.e5.item5')}</li>
        </ul>
      </details>
      {scopeErr && <p className="desk-err">{scopeErr}</p>}
      {!ready && <p className="desk-muted">{t('desk.loadingCompanies')}</p>}
      {ready && companies.length > 0 && (
        <div className="desk-tool" style={{ marginTop: '0.75rem' }}>
          <CompanyScopeSelect me={me} companies={companies} companyId={companyId} onChange={setCompanyId} />
        </div>
      )}
      <div className="desk-form-panel" style={{ marginTop: '0.75rem', maxWidth: '40rem' }}>
        <div className="desk-form" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <label>
            {t('desk.reconciliation.fromUtc')}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {t('desk.reconciliation.toUtc')}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="desk-form-actions" style={{ marginTop: '0.5rem' }}>
          <button type="button" onClick={() => void loadPreview()} disabled={!companyId || loading}>
            {loading ? t('desk.loadingGate') : t('desk.reconciliation.runPreview')}
          </button>
          <button type="button" onClick={downloadCsv} disabled={!companyId}>
            {t('desk.reconciliation.downloadCsv')}
          </button>
        </div>
      </div>
      {err && <p className="desk-err">{err}</p>}
      {preview && stats && (
        <div style={{ marginTop: '1.25rem' }}>
          <div
            className="desk-form-panel"
            style={{
              maxWidth: '44rem',
              background: '#f1f5f9',
              borderColor: '#cbd5e1',
            }}
          >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{t('desk.reconciliation.summaryTitle')}</p>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.55, fontSize: '0.9rem' }}>
              <li>
                <strong>{preview.rowCount}</strong> {t('desk.reconciliation.summary.rowCountLabel')}
                {displayRows.length !== preview.rowCount && (
                  <>
                    {' '}
                    {t('desk.reconciliation.summary.afterFilter').replace('{count}', String(displayRows.length))}
                  </>
                )}
              </li>
              <li>
                {t('desk.reconciliation.summary.matchIntro')}{' '}
                <strong>{matchLabels.BOTH}</strong> {stats.byReason.BOTH},{' '}
                <strong>{matchLabels.RENTAL_PAID_IN_WINDOW}</strong> {stats.byReason.RENTAL_PAID_IN_WINDOW},{' '}
                <strong>{matchLabels.DEPOSIT_ACTIVITY_IN_WINDOW}</strong>{' '}
                {stats.byReason.DEPOSIT_ACTIVITY_IN_WINDOW}
              </li>
              <li>
                {t('desk.reconciliation.summary.sourceIntro')}{' '}
                <strong>{stats.publicWeb}</strong> {t('desk.reconciliation.summary.segmentPublic')} ·{' '}
                <strong>{stats.staff}</strong> {t('desk.reconciliation.summary.segmentDesk')}
              </li>
              {stats.anomalyRows > 0 && (
                <li className="desk-err" style={{ color: '#b45309' }}>
                  {t('desk.reconciliation.summary.anomaly').replace('{count}', String(stats.anomalyRows))}
                </li>
              )}
              <li className="desk-muted" style={{ fontSize: '0.85rem' }}>
                {t('desk.reconciliation.summary.refundRows').replace(
                  '{count}',
                  String(preview.refundRowCount),
                )}
              </li>
              <li className="desk-muted" style={{ fontSize: '0.85rem' }}>
                {t('desk.reconciliation.summary.webhookEvents').replace(
                  '{count}',
                  String(preview.processedStripeEventCount),
                )}
              </li>
            </ul>
          </div>

          <div className="desk-tool" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              {t('desk.reconciliation.filterLabel')}
              <select
                value={matchFilter}
                onChange={(e) => setMatchFilter(e.target.value as typeof matchFilter)}
              >
                <option value="ALL">{t('desk.reconciliation.filter.all')}</option>
                <option value="BOTH">{matchLabels.BOTH}</option>
                <option value="RENTAL_PAID_IN_WINDOW">{matchLabels.RENTAL_PAID_IN_WINDOW}</option>
                <option value="DEPOSIT_ACTIVITY_IN_WINDOW">{matchLabels.DEPOSIT_ACTIVITY_IN_WINDOW}</option>
              </select>
            </label>
          </div>

          <p className="desk-muted" style={{ fontSize: '0.82rem', marginTop: '0.5rem', maxWidth: '48rem' }}>
            {t('desk.reconciliation.apiNote')}
          </p>

          <div className="desk-table-wrap" style={{ marginTop: '0.5rem' }}>
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.reconciliation.th.reservation')}</th>
                  <th>{t('desk.reconciliation.th.match')}</th>
                  <th>{t('desk.reconciliation.th.source')}</th>
                  <th>{t('desk.reconciliation.th.paidPickup')}</th>
                  <th>{t('desk.reconciliation.th.rentalCheckout')}</th>
                  <th>{t('desk.reconciliation.th.deposit')}</th>
                  <th>{t('desk.reconciliation.th.total')}</th>
                  <th>{t('desk.reconciliation.th.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => {
                  const flags = rowIntegrityFlags(r, t);
                  const src = formatDeskReservationSource(r.source, t, { context: 'reconciliation' });
                  const resHref =
                    companyId &&
                    `/desk/reservations?companyId=${encodeURIComponent(companyId)}&open=${encodeURIComponent(r.reservationId)}`;
                  return (
                    <tr key={r.reservationId}>
                      <td>
                        <code style={{ fontSize: '0.78rem' }}>{shortenId(r.reservationId, 10)}</code>
                        <div className="desk-muted" style={{ fontSize: '0.78rem' }}>
                          {r.customerName} · {formatDeskReservationStatus(r.status, t)}
                        </div>
                        {resHref && (
                          <div style={{ marginTop: 4 }}>
                            <Link href={resHref} style={{ fontSize: '0.82rem' }}>
                              {t('desk.reconciliation.openInDesk')}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{matchLabels[r.matchReason]}</td>
                      <td style={{ fontSize: '0.82rem' }}>
                        <span className={src.muted ? 'desk-muted' : undefined} title={src.title}>
                          {src.label}
                        </span>
                      </td>
                      <td className="desk-muted" style={{ fontSize: '0.78rem' }}>
                        {r.paidAt ? fmtShort(r.paidAt, locale) : '—'}
                        <div>{fmtShort(r.pickupAt, locale)}</div>
                      </td>
                      <td className="desk-muted" style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>
                        {shortenId(r.stripeCheckoutSessionId, 18)}
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        <span title={r.depositHoldStatus}>
                          {formatDepositHoldStatus(r.depositHoldStatus, t)}
                          {r.depositHoldCents != null && r.depositHoldCents > 0 && (
                            <span> · {fmtMoney(r.depositHoldCents, r.currency)}</span>
                          )}
                        </span>
                        <div className="desk-muted" style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                          {shortenId(r.stripeDepositCheckoutSessionId, 12)}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{fmtMoney(r.totalCents, r.currency)}</td>
                      <td style={{ fontSize: '0.75rem' }}>
                        {flags.length === 0 ? (
                          <span className="desk-ok">—</span>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: '1rem', color: '#b45309' }}>
                            {flags.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {displayRows.length === 0 && <p className="desk-muted">{t('desk.reconciliation.emptyFilter')}</p>}
          </div>

          <h2 style={{ marginTop: '1.5rem', fontSize: '1.1rem' }}>
            {t('desk.reconciliation.refundsSectionTitle')}
          </h2>
          <div className="desk-table-wrap" style={{ marginTop: '0.5rem' }}>
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.reconciliation.th.refReservation')}</th>
                  <th>{t('desk.reconciliation.th.refStripeId')}</th>
                  <th>{t('desk.reconciliation.th.refKind')}</th>
                  <th>{t('desk.reconciliation.th.refAmount')}</th>
                  <th>{t('desk.reconciliation.th.refCreated')}</th>
                  <th>{t('desk.reconciliation.th.refBy')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.refunds.map((rf) => {
                  const resHref =
                    companyId &&
                    `/desk/reservations?companyId=${encodeURIComponent(companyId)}&open=${encodeURIComponent(rf.reservationId)}`;
                  return (
                    <tr key={rf.ledgerId}>
                      <td>
                        <code style={{ fontSize: '0.78rem' }}>{shortenId(rf.reservationId, 10)}</code>
                        {resHref && (
                          <div style={{ marginTop: 4 }}>
                            <Link href={resHref} style={{ fontSize: '0.82rem' }}>
                              {t('desk.reconciliation.openInDesk')}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="desk-muted" style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>
                        {shortenId(rf.stripeRefundId, 18)}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>{formatRefundKind(rf.kind, t)}</td>
                      <td style={{ fontSize: '0.85rem' }}>{fmtMoney(rf.amountCents, rf.currency)}</td>
                      <td className="desk-muted" style={{ fontSize: '0.78rem' }}>
                        {fmtShort(rf.createdAt, locale)}
                      </td>
                      <td className="desk-muted" style={{ fontSize: '0.75rem' }}>
                        {rf.createdByUserId ? shortenId(rf.createdByUserId, 10) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {preview.refunds.length === 0 && (
              <p className="desk-muted">{t('desk.reconciliation.refundsEmpty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReconciliationPage() {
  const { t } = usePublicLocaleContext();
  return (
    <Suspense fallback={<p className="desk-muted">{t('desk.loadingGate')}</p>}>
      <ReconciliationContent />
    </Suspense>
  );
}
