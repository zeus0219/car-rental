'use client';

import { useCallback, useEffect, useState } from 'react';
import { COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY, reservationStatusValues } from '@car-rental/shared';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { formatDeskCargosSubmissionStatus } from '../../../lib/desk-cargos-submission-status';
import { formatDeskReportReservationStatus } from '../../../lib/desk-report-reservation-status-label';
import { formatDeskReservationSource } from '../../../lib/desk-reservation-source-label';
import type { PublicMessageKey } from '../../../lib/public-messages';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type CompanyReport = {
  companyId: string;
  companyName: string;
  from: string;
  to: string;
  completedRevenueCents: number;
  completedReservationsInReturnWindow: number;
  reservationsCreatedInRange: {
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
  };
  cargosSubmissionsCreatedInRange: Record<string, number>;
  cargosAtAGlance: {
    totalCreated: number;
    inFlight: number;
    mockSent: number;
    failed: number;
    skipped: number;
  };
  cargosDailyCreated: { day: string; byStatus: Record<string, number>; total: number }[];
  utilization: {
    definitionKey: typeof COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY;
    calendarDaysInRange: number;
    fleetVehicleCount: number;
    bookedMsInRange: number;
    fleetUtilizationPercent: number | null;
    byVehicleClass: {
      vehicleClassId: string;
      className: string;
      classCode: string;
      vehicleCount: number;
      bookedMsInRange: number;
      utilizationPercent: number | null;
    }[];
  };
};

function monthRange(d: Date): { from: string; to: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m + 1, 0));
  const to = last.toISOString().slice(0, 10);
  return { from, to };
}

function lastMonthRange(d: Date): { from: string; to: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  const from = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(prevY, prevM + 1, 0));
  return { from, to: last.toISOString().slice(0, 10) };
}

function last30DaysRange(d: Date): { from: string; to: string } {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function ytdRange(d: Date): { from: string; to: string } {
  const y = d.getUTCFullYear();
  const from = `${y}-01-01`;
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

const REPORT_SOURCE_ORDER = ['PUBLIC_WEB', 'PARTNER', 'STAFF'] as const;
const REPORT_RESERVATION_STATUS_ORDER = [
  'QUOTE',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
const REPORT_CARGOS_STATUS_ORDER = ['PENDING', 'PROCESSING', 'MOCK_SENT', 'FAILED', 'SKIPPED'] as const;

function sortReportEntries(entries: [string, number][], order: readonly string[]): [string, number][] {
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? 999 : i;
  };
  return [...entries].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

export default function ReportsPage() {
  const { t } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [from, setFrom] = useState(() => monthRange(new Date()).from);
  const [to, setTo] = useState(() => monthRange(new Date()).to);
  const [report, setReport] = useState<CompanyReport | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setFromTo = useCallback((r: { from: string; to: string }) => {
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ companyId, from, to });
      const r = await apiJson<CompanyReport>(`/reports/company?${qs.toString()}`);
      setReport(r);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, from, to, t]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void load();
  }, [ready, companyId, load]);

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return null;
  if (scopeErr) return <p className="desk-err">{scopeErr}</p>;
  if (!ready) return <p className="desk-muted">{t('desk.loadingCompanies')}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.reports.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '48rem' }}>
        {t('desk.reports.intro')}
      </p>
      <CompanyScopeSelect me={me} companies={companies} companyId={companyId} onChange={setCompanyId} />
      <div className="desk-tool" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.reports.fromUtc')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.reports.toUtc')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" onClick={() => void load()}>
          {t('desk.reports.refresh')}
        </button>
      </div>
      <div className="desk-tool" style={{ marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.35rem' }}>
        <button type="button" onClick={() => setFromTo(monthRange(new Date()))}>
          {t('desk.reports.presets.thisMonth')}
        </button>
        <button type="button" onClick={() => setFromTo(lastMonthRange(new Date()))}>
          {t('desk.reports.presets.lastMonth')}
        </button>
        <button type="button" onClick={() => setFromTo(last30DaysRange(new Date()))}>
          {t('desk.reports.presets.last30')}
        </button>
        <button type="button" onClick={() => setFromTo(ytdRange(new Date()))}>
          {t('desk.reports.presets.ytd')}
        </button>
      </div>
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {loading && <p className="desk-muted">{t('booking.loading')}</p>}
      {report && !loading && (
        <div style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>
            {report.companyName}{' '}
            <span className="desk-muted" style={{ fontWeight: 400, fontSize: '0.95rem' }}>
              ({report.from} → {report.to} UTC)
            </span>
          </h2>
          <p style={{ fontSize: '1.1rem' }}>
            <strong>{t('desk.reports.completedRevenue')}</strong> {formatEur(report.completedRevenueCents)}
          </p>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            {t('desk.reports.completedRows')} {report.completedReservationsInReturnWindow}
          </p>

          <h3 style={{ fontSize: '1rem', marginTop: '1.25rem' }}>{t('desk.reports.utilHeading')}</h3>
          <p className="desk-muted" style={{ fontSize: '0.9rem', maxWidth: '48rem' }}>
            {report.utilization.definitionKey === COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY
              ? t(COMPANY_REPORT_UTILIZATION_DEFINITION_I18N_KEY as PublicMessageKey)
              : report.utilization.definitionKey}
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            <strong>{t('desk.reports.fleetVehicles')}</strong> {report.utilization.fleetVehicleCount} ·{' '}
            <strong>{t('desk.reports.calendarDays')}</strong> {report.utilization.calendarDaysInRange.toFixed(2)} ·{' '}
            <strong>{t('desk.reports.fleetUtilLabel')}</strong>{' '}
            {report.utilization.fleetUtilizationPercent != null
              ? `${report.utilization.fleetUtilizationPercent.toFixed(1)}%`
              : '—'}
          </p>
          {report.utilization.byVehicleClass.length > 0 && (
            <table className="desk-table" style={{ marginTop: '0.5rem', maxWidth: '44rem' }}>
              <thead>
                <tr>
                  <th>{t('desk.reports.th.class')}</th>
                  <th>{t('desk.reports.th.vehicles')}</th>
                  <th>{t('desk.reports.th.util')}</th>
                </tr>
              </thead>
              <tbody>
                {report.utilization.byVehicleClass.map((row) => (
                  <tr key={row.vehicleClassId}>
                    <td>
                      {row.className} <span className="desk-muted">({row.classCode})</span>
                    </td>
                    <td>{row.vehicleCount}</td>
                    <td>
                      {row.utilizationPercent != null ? `${row.utilizationPercent.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ fontSize: '1rem', marginTop: '1.25rem' }}>{t('desk.reports.bySource')}</h3>
          <ul style={{ margin: '0.25rem 0' }}>
            {Object.keys(report.reservationsCreatedInRange.bySource).length === 0 ? (
              <li className="desk-muted">—</li>
            ) : (
              sortReportEntries(
                Object.entries(report.reservationsCreatedInRange.bySource),
                REPORT_SOURCE_ORDER,
              ).map(([k, v]) => {
                const src = formatDeskReservationSource(k, t, { context: 'reports' });
                return (
                  <li key={k}>
                    {src.displayAsCode ? (
                      <code title={src.title}>{src.label}</code>
                    ) : (
                      src.label
                    )}
                    : {v}
                  </li>
                );
              })
            )}
          </ul>
          <h3 style={{ fontSize: '1rem' }}>{t('desk.reports.byStatus')}</h3>
          <ul style={{ margin: '0.25rem 0' }}>
            {Object.keys(report.reservationsCreatedInRange.byStatus).length === 0 ? (
              <li className="desk-muted">—</li>
            ) : (
              sortReportEntries(
                Object.entries(report.reservationsCreatedInRange.byStatus),
                REPORT_RESERVATION_STATUS_ORDER,
              ).map(([k, v]) => {
                const known = (reservationStatusValues as readonly string[]).includes(k);
                return (
                  <li key={k}>
                    {known ? formatDeskReportReservationStatus(k, t) : <code>{k}</code>}: {v}
                  </li>
                );
              })
            )}
          </ul>
          <h3 style={{ fontSize: '1rem', marginTop: '1.25rem' }}>{t('desk.reports.cargosGlance')}</h3>
          <ul className="desk-muted" style={{ margin: '0.25rem 0', maxWidth: '44rem' }}>
            <li>
              <strong>{t('desk.reports.cargosGlance.total')}</strong> {report.cargosAtAGlance.totalCreated}
            </li>
            <li>
              <strong>{t('desk.reports.cargosGlance.inFlight')}</strong> {report.cargosAtAGlance.inFlight}
            </li>
            <li>
              <strong>{t('desk.reports.cargosGlance.mockSent')}</strong> {report.cargosAtAGlance.mockSent}
            </li>
            <li>
              <strong>{t('desk.reports.cargosGlance.failed')}</strong> {report.cargosAtAGlance.failed}
            </li>
            <li>
              <strong>{t('desk.reports.cargosGlance.skipped')}</strong> {report.cargosAtAGlance.skipped}
            </li>
          </ul>
          <h3 style={{ fontSize: '1rem' }}>{t('desk.reports.cargosByStatus')}</h3>
          <ul style={{ margin: '0.25rem 0' }}>
            {Object.keys(report.cargosSubmissionsCreatedInRange).length === 0 ? (
              <li className="desk-muted">—</li>
            ) : (
              sortReportEntries(
                Object.entries(report.cargosSubmissionsCreatedInRange),
                REPORT_CARGOS_STATUS_ORDER,
              ).map(([k, v]) => {
                const cargosLbl = formatDeskCargosSubmissionStatus(k, t);
                return (
                  <li key={k}>
                    {cargosLbl === k ? <code>{k}</code> : cargosLbl}: {v}
                  </li>
                );
              })
            )}
          </ul>
          <h3 style={{ fontSize: '1rem', marginTop: '1.25rem' }}>{t('desk.reports.cargosDailyHeading')}</h3>
          <p className="desk-muted" style={{ fontSize: '0.9rem', maxWidth: '48rem' }}>
            {t('desk.reports.cargosDailyIntro')}
          </p>
          {report.cargosDailyCreated.length > 0 && (
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <table className="desk-table" style={{ marginTop: '0.5rem', minWidth: '36rem' }}>
                <thead>
                  <tr>
                    <th>{t('desk.reports.cargosDaily.th.day')}</th>
                    {REPORT_CARGOS_STATUS_ORDER.map((st) => (
                      <th key={st}>{formatDeskCargosSubmissionStatus(st, t)}</th>
                    ))}
                    <th>{t('desk.reports.cargosDaily.th.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.cargosDailyCreated.map((row) => (
                    <tr key={row.day}>
                      <td>
                        <code>{row.day}</code>
                      </td>
                      {REPORT_CARGOS_STATUS_ORDER.map((st) => (
                        <td key={st}>{row.byStatus[st] ?? 0}</td>
                      ))}
                      <td>
                        <strong>{row.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
