'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_VERSION, type ReservationCompanySummary } from '@car-rental/shared';
import { usePublicLocaleContext } from '../../components/PublicLocaleProvider';
import { apiJson, getApiBase } from '../../lib/api';
import { formatDeskHealthDbState, formatDeskHealthSummaryStatus } from '../../lib/desk-health-summary-labels';
import { formatDeskUserRole } from '../../lib/desk-user-role-label';
import { useCompanyScope } from '../../lib/use-company-scope';
import { useMe } from '../../lib/use-me';

type HealthSummary = {
  status?: string;
  service?: string;
  database?: string;
  apiVersion?: string;
  uptimeSec?: number;
  nodeEnv?: string;
  redis?: string;
  queues?: {
    cargosInflight: number;
    sdiInflight: number;
    customerDocumentOcrPending: number;
    partnerWebhookPending: number;
  };
};

function canViewAuditLink(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'BRANCH_MANAGER' || role === 'READONLY_ACCOUNTING';
}

export default function DeskDashboard() {
  const { t } = usePublicLocaleContext();
  const { me, loading, error: err } = useMe();
  const { companyId, ready: scopeReady, err: scopeErr } = useCompanyScope(me);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [summary, setSummary] = useState<ReservationCompanySummary | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!scopeReady || !companyId) {
      return;
    }
    setSummaryRefreshing(true);
    try {
      const s = await apiJson<ReservationCompanySummary>(
        `/reservations/summary?companyId=${encodeURIComponent(companyId)}`,
      );
      setSummary(s);
      setSummaryErr(null);
    } catch (e) {
      setSummary(null);
      setSummaryErr(e instanceof Error ? e.message : t('desk.err.summary'));
    } finally {
      setSummaryRefreshing(false);
    }
  }, [scopeReady, companyId, t]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && scopeReady && companyId) {
        void loadSummary();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [scopeReady, companyId, loadSummary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rHealth = await fetch(`${getApiBase()}/health/summary`);
        if (rHealth.ok && !cancelled) {
          setHealth((await rHealth.json()) as HealthSummary);
        }
      } catch {
        // health is optional on dashboard
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (err) return <p className="desk-err">{err}</p>;

  return (
    <div>
      <h1 className="dash-title">{t('desk.dashboard.title')}</h1>
      {scopeErr && <p className="desk-err">{scopeErr}</p>}
      <section className="dash-section">
        <h2>{t('desk.section.operations')}</h2>
        <p>
          <Link href="/desk/reservations">{t('desk.link.reservations')}</Link>
          {' · '}
          <Link href="/desk/calendar">{t('desk.link.calendar')}</Link>
          {' · '}
          <Link href="/desk/customers">{t('desk.link.customers')}</Link>
          {' · '}
          <Link href="/desk/fleet">{t('desk.link.fleet')}</Link>
          {' · '}
          <Link href="/quote">{t('desk.link.quote')}</Link>
        </p>
      </section>
      <section className="dash-section">
        <h2>{t('desk.section.desk')}</h2>
        <p>
          <Link href="/desk/reservations">{t('desk.link.reservations')}</Link>
          {' · '}
          <Link href="/desk/reservations?source=PUBLIC_WEB">{t('desk.link.webQuotes')}</Link>
          {' · '}
          <Link href="/desk/fleet">{t('desk.link.fleet')}</Link>
          {' · '}
          <Link href="/desk/organization">{t('desk.link.companyStations')}</Link>
          {' · '}
          <Link href="/desk/team">{t('desk.link.team')}</Link>
          {me && canViewAuditLink(me.role) && (
            <>
              {' · '}
              <Link href="/desk/audit">{t('desk.link.audit')}</Link>
            </>
          )}
        </p>
      </section>
      {me && (
        <section className="dash-section">
          <h2>{t('desk.section.user')}</h2>
          <p>
            {me.firstName} {me.lastName} — <strong>{me.email}</strong>
          </p>
          <p className="desk-muted" style={{ margin: '0.25rem 0 0' }}>
            {t('desk.user.role')}{' '}
            <span title={me.role}>{formatDeskUserRole(me.role, t)}</span> · {t('desk.user.companyId')}{' '}
            <code>{me.companyId}</code>
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>
            <Link href="/desk/account">{t('desk.nav.account')}</Link> — {t('desk.accountSub')}
          </p>
        </section>
      )}
      {scopeReady && companyId && (
        <section className="dash-section">
          <div className="dash-actions">
            <h2>{t('desk.summary.title')}</h2>
            <button
              type="button"
              onClick={() => {
                void loadSummary();
              }}
              disabled={summaryRefreshing}
            >
              {summaryRefreshing ? t('desk.refreshing') : t('desk.refresh')}
            </button>
            {me && canViewAuditLink(me.role) && (
              <Link href="/desk/audit?action=reservation">{t('desk.link.reservationAudit')}</Link>
            )}
          </div>
          {summaryErr && <p className="desk-err">{summaryErr}</p>}
          {summary && !summaryErr && (
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">{t('desk.metric.webOpenQuotes')}</div>
                <div className="metric-value">{summary.publicWebOpenQuotes}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">{t('desk.metric.upcomingPickups')}</div>
                <div className="metric-value">{summary.upcomingPickupsNext7Days}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">{t('desk.metric.inProgress')}</div>
                <div className="metric-value">{summary.byStatus.IN_PROGRESS}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">{t('desk.metric.allQuotes')}</div>
                <div className="metric-value">{summary.byStatus.QUOTE}</div>
              </div>
            </div>
          )}
        </section>
      )}
      <section className="dash-section">
        <h2>{t('desk.api.title')}</h2>
        <ul className="dash-list">
          <li>
            {t('desk.api.sharedVersion')} <code>API_VERSION</code>: {API_VERSION}
          </li>
          <li>
            {t('desk.api.baseUrl')} <code>{getApiBase()}</code>
          </li>
          {health && (
            <>
              <li>
                {t('desk.api.summaryProbe')}{' '}
                <code title={health.status}>{formatDeskHealthSummaryStatus(health.status, t)}</code> ·{' '}
                <code>
                  {t('desk.api.apiVersion')} {String(health.apiVersion)}
                </code>
              </li>
              <li>
                {t('desk.api.db')}{' '}
                <code title={health.database ?? undefined}>
                  {formatDeskHealthDbState(health.database, t)}
                </code>
              </li>
              {health.uptimeSec != null && (
                <li>
                  {t('desk.api.uptime')}{' '}
                  {t('desk.api.uptimeSeconds').replace('{n}', String(health.uptimeSec))}
                </li>
              )}
              {health.nodeEnv && (
                <li>
                  {t('desk.api.nodeEnv')} <code>{health.nodeEnv}</code>
                </li>
              )}
              {health.redis && (
                <li>
                  {t('desk.api.redis')}{' '}
                  {health.redis === 'configured' ? t('desk.api.redisOn') : t('desk.api.redisOff')}
                </li>
              )}
              {health.queues && (
                <li>
                  {t('desk.api.queues')}{' '}
                  <code>
                    {t('desk.api.queuePartnerWebhook')} {health.queues.partnerWebhookPending ?? 0}
                  </code>
                  {' · '}
                  <code>
                    {t('desk.api.queueOcrDoc')} {health.queues.customerDocumentOcrPending ?? 0}
                  </code>
                  {(health.queues.customerDocumentOcrPending ?? 0) > 0 && companyId && (
                    <>
                      {' '}
                      <Link
                        href={`/desk/customers?ocrPending=1&companyId=${encodeURIComponent(companyId)}`}
                      >
                        {t('desk.api.ocrPendingCustomers')}
                      </Link>
                    </>
                  )}
                  {' · '}
                  <code>
                    {t('desk.api.queueCargos')} {health.queues.cargosInflight}
                  </code>
                  {' · '}
                  <code>
                    {t('desk.api.queueSdi')} {health.queues.sdiInflight}
                  </code>
                </li>
              )}
            </>
          )}
        </ul>
        <details
          className="desk-muted"
          style={{ marginTop: '0.65rem', fontSize: '0.82rem', maxWidth: '42rem' }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.a6.summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.a6.lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.a6.item1')}</li>
            <li>{t('desk.a6.item2')}</li>
            <li>{t('desk.a6.item3')}</li>
            <li>{t('desk.a6.item4')}</li>
            <li>{t('desk.a6.item5')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{ marginTop: '0.35rem', fontSize: '0.82rem', maxWidth: '42rem' }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.a4.summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.a4.lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.a4.item1')}</li>
            <li>{t('desk.a4.item2')}</li>
            <li>{t('desk.a4.item3')}</li>
            <li>{t('desk.a4.item4')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{ marginTop: '0.35rem', fontSize: '0.82rem', maxWidth: '42rem' }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.a5.summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.a5.lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.a5.item1')}</li>
            <li>{t('desk.a5.item2')}</li>
            <li>{t('desk.a5.item3')}</li>
            <li>{t('desk.a5.item4')}</li>
            <li>{t('desk.a5.item5')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{ marginTop: '0.35rem', fontSize: '0.82rem', maxWidth: '42rem' }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.a7.summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.a7.lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.a7.item1')}</li>
            <li>{t('desk.a7.item2')}</li>
            <li>{t('desk.a7.item3')}</li>
            <li>{t('desk.a7.item4')}</li>
          </ul>
        </details>
        <p className="desk-muted">{t('desk.api.footer')}</p>
      </section>
    </div>
  );
}
