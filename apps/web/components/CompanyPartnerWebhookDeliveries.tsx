'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import type { PublicLocale } from '../lib/public-locale';
import type { Me } from '../lib/me-types';

const PAGE_SIZE = 25;

function makeFmtDeskDateTime(locale: PublicLocale) {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  return (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };
}

function canViewPartnerWebhookLog(me: Me, companyId: string): boolean {
  if (me.role === 'READONLY_ACCOUNTING' && me.companyId === companyId) return true;
  if (me.role === 'ADMIN') return true;
  if (me.role === 'BRANCH_MANAGER' && me.companyId === companyId) return true;
  return false;
}

type DeliveryRow = {
  id: string;
  partnerApiKeyId: string;
  partnerApiKeyName: string;
  reservationId: string;
  event: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  succeededAt: string | null;
  createdAt: string;
};

type ListResponse = { total: number; items: DeliveryRow[] };

function truncateErr(s: string | null, max = 120): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

type StatusFilter = '' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'DEAD';

type Props = {
  me: Me;
  companyId: string;
};

export function CompanyPartnerWebhookDeliveries({ me, companyId }: Props) {
  const { t, locale } = usePublicLocaleContext();
  const fmtDt = useMemo(() => makeFmtDeskDateTime(locale), [locale]);
  const canView = canViewPartnerWebhookLog(me, companyId);
  const [status, setStatus] = useState<StatusFilter>('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(PAGE_SIZE));
      qs.set('offset', String(offset));
      if (status) {
        qs.set('status', status);
      }
      const res = await apiJson<ListResponse>(
        `/companies/${encodeURIComponent(companyId)}/partner-webhook-deliveries?${qs.toString()}`,
      );
      setData(res);
      setLoadErr(null);
    } catch (e) {
      setData(null);
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, offset, status, t]);

  useEffect(() => {
    void load();
  }, [load, canView]);

  if (!canView) {
    return null;
  }

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h3 style={{ fontSize: '1.02rem', margin: '0 0 0.35rem' }}>
        {t('desk.organization.partnerWebhookDeliv.title')}
      </h3>
      <p className="desk-muted" style={{ margin: '0 0 0.75rem', maxWidth: '44rem', fontSize: '0.9rem' }}>
        {t('desk.organization.partnerWebhookDeliv.hint')}
      </p>
      <div className="desk-tool" style={{ marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span className="desk-muted" style={{ fontSize: '0.85rem' }}>
            {t('desk.organization.partnerWebhookDeliv.filterStatus')}
          </span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setOffset(0);
            }}
            aria-label={t('desk.organization.partnerWebhookDeliv.filterStatus')}
          >
            <option value="">{t('desk.organization.partnerWebhookDeliv.all')}</option>
            <option value="PENDING">PENDING</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="SUCCEEDED">SUCCEEDED</option>
            <option value="DEAD">DEAD</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? t('desk.ui.buttonBusy') : t('desk.organization.partnerWebhookDeliv.refresh')}
        </button>
      </div>
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {loading && !data && !loadErr && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loadErr && !loading && data && data.items.length === 0 && (
        <p className="desk-muted">{t('desk.organization.partnerWebhookDeliv.empty')}</p>
      )}
      {!loadErr && data && data.items.length > 0 && (
        <>
          <p className="desk-muted" style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
            {t('desk.organization.partnerWebhookDeliv.range')
              .replace('{start}', String(start))
              .replace('{end}', String(end))
              .replace('{total}', String(total))}
          </p>
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.created')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.status')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.key')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.event')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.reservation')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.attempts')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.nextRetry')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.http')}</th>
                  <th>{t('desk.organization.partnerWebhookDeliv.th.error')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {fmtDt(r.createdAt)}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.78rem' }}>{r.status}</code>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{r.partnerApiKeyName}</td>
                    <td className="desk-muted" style={{ fontSize: '0.8rem' }}>
                      {r.event}
                    </td>
                    <td>
                      <Link
                        href={`/desk/reservations?companyId=${encodeURIComponent(companyId)}&open=${encodeURIComponent(r.reservationId)}`}
                        style={{ fontSize: '0.85rem' }}
                      >
                        {t('desk.organization.partnerWebhookDeliv.openReservation')}
                      </Link>
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.attemptCount}/{r.maxAttempts}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.status === 'SUCCEEDED' || r.status === 'DEAD'
                        ? t('desk.fleet.quote.emDash')
                        : fmtDt(r.nextAttemptAt)}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.lastHttpStatus != null ? String(r.lastHttpStatus) : t('desk.fleet.quote.emDash')}
                    </td>
                    <td
                      className="desk-muted"
                      style={{ fontSize: '0.78rem', maxWidth: '14rem', wordBreak: 'break-word' }}
                      title={r.lastError ?? undefined}
                    >
                      {truncateErr(r.lastError) || t('desk.fleet.quote.emDash')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="desk-tool" style={{ marginTop: '0.65rem' }}>
            <button type="button" disabled={!canPrev || loading} onClick={() => setOffset((o) => o - PAGE_SIZE)}>
              {t('desk.organization.partnerWebhookDeliv.prev')}
            </button>
            <button type="button" disabled={!canNext || loading} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
              {t('desk.organization.partnerWebhookDeliv.next')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
