'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReservationForm } from '../../../components/ReservationForm';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { translateDeskApiErrorLine } from '../../../lib/desk-api-error-i18n';
import { formatDeskCargosSubmissionStatus } from '../../../lib/desk-cargos-submission-status';
import { formatDamageReportStatus } from '../../../lib/desk-damage-report-status';
import { formatRentalAgreementStatus } from '../../../lib/desk-rental-agreement-status';
import { formatDeskReservationStatus } from '../../../lib/desk-reservation-status-label';
import type { PublicMessageKey } from '../../../lib/public-messages';
import type { PublicLocale } from '../../../lib/public-locale';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type OpsView = 'active' | 'returned';

type Res = {
  id: string;
  status: string;
  pickupAt: string;
  returnAt: string;
  customerId: string | null;
  customerName: string;
  rentalAgreement: {
    id: string;
    status: string;
    agreementTemplateVersion: string | null;
    signedAt: string | null;
    signedByName: string | null;
    signedClientIp: string | null;
    _count?: { attachments: number };
  } | null;
  damageReport: {
    id: string;
    status: string;
    notes: string | null;
    _count?: { photos: number; lines: number };
  } | null;
  vehicle: { licensePlate: string; modelLabel: string | null };
  pickupStation: { name: string; code: string };
  odometerOutKm: number | null;
  odometerInKm: number | null;
};

type CargosSubRow = {
  id: string;
  reservationId: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

function latestCargosByReservation(subs: CargosSubRow[]): Map<string, CargosSubRow> {
  const m = new Map<string, CargosSubRow>();
  for (const s of subs) {
    if (!m.has(s.reservationId)) {
      m.set(s.reservationId, s);
    }
  }
  return m;
}

function makeFmtLocale(locale: PublicLocale) {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  return (d: string) => {
    try {
      return new Date(d).toLocaleString(loc, {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return d;
    }
  };
}

function deskReservationsListPath(operationsPathname: string): string {
  return operationsPathname.replace(/\/[^/]+$/, '/reservations');
}

function agreementOpsCell(
  r: Res['rentalAgreement'],
  t: (k: PublicMessageKey) => string,
): { short: string; title: string } {
  const dash = t('desk.fleet.quote.emDash');
  if (!r) {
    return { short: dash, title: t('desk.reservations.agreement.noAgreement') };
  }
  const ver = r.agreementTemplateVersion?.trim();
  const statusLabel = formatRentalAgreementStatus(r.status, t);
  const n = r._count?.attachments ?? 0;
  const parts = [statusLabel];
  if (ver) {
    parts.push(ver);
  }
  if (n > 0) {
    parts.push(t('desk.reservations.agreement.filesN').replace('{n}', String(n)));
  }
  const short = parts.join(' · ');
  const L = (key: PublicMessageKey, value: string) => t(key).replace('{value}', value);
  const titleLines = [
    L('desk.reservations.agreement.lineStatus', statusLabel),
    L('desk.reservations.agreement.lineTemplate', ver || dash),
    L('desk.reservations.agreement.lineSignedAt', r.signedAt || dash),
    L('desk.reservations.agreement.lineSignedAs', r.signedByName || dash),
    L('desk.reservations.agreement.lineClientIp', r.signedClientIp || dash),
    L('desk.reservations.agreement.lineAttachments', n > 0 ? String(n) : dash),
  ];
  return { short, title: titleLines.join('\n') };
}

function damageOpsCell(
  d: Res['damageReport'],
  t: (k: PublicMessageKey) => string,
): { short: string; title: string } {
  const dash = t('desk.fleet.quote.emDash');
  if (!d) {
    return { short: dash, title: t('desk.reservations.damage.none') };
  }
  const statusLabel = formatDamageReportStatus(d.status, t);
  const lines = d._count?.lines ?? 0;
  const photos = d._count?.photos ?? 0;
  const short = t('desk.reservations.damage.short')
    .replace('{status}', statusLabel)
    .replace('{lines}', String(lines))
    .replace('{photos}', String(photos));
  const note = d.notes?.trim();
  const title = [
    statusLabel,
    t('desk.reservations.damage.titleLines').replace('{lines}', String(lines)).replace('{photos}', String(photos)),
    note ? `${t('desk.reservations.damage.notes')}: ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { short, title };
}

const ACTIVE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] as const satisfies readonly string[];
const RETURNED_STATUSES = ['COMPLETED'] as const satisfies readonly string[];

function isOpsView(v: string | null): v is OpsView {
  return v === 'active' || v === 'returned';
}

function OperationsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, locale } = usePublicLocaleContext();
  const fmt = useMemo(() => makeFmtLocale(locale), [locale]);
  const viewRaw = searchParams.get('view');
  const view: OpsView = isOpsView(viewRaw) ? viewRaw : 'active';

  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [rows, setRows] = useState<Res[]>([]);
  const [cargosByRes, setCargosByRes] = useState<Map<string, CargosSubRow>>(() => new Map());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const onCompanyScopeChange = useCallback(
    (nextCompanyId: string) => {
      setCompanyId(nextCompanyId);
      const params = new URLSearchParams(searchParams.toString());
      params.set('companyId', nextCompanyId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, setCompanyId],
  );

  useEffect(() => {
    if (!ready || !companyId) {
      return;
    }
    const qp = searchParams.get('companyId');
    if (qp === companyId) {
      return;
    }
    if (qp && companies.some((c) => c.id === qp)) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('companyId', companyId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [ready, companyId, companies, pathname, router, searchParams]);

  const statusesCsv =
    view === 'returned' ? RETURNED_STATUSES.join(',') : ACTIVE_STATUSES.join(',');

  const loadRows = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setLoading(true);
    try {
      const list = await apiJson<Res[]>(
        `/reservations?companyId=${encodeURIComponent(companyId)}&statuses=${encodeURIComponent(statusesCsv)}`,
      );
      setRows(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, statusesCsv, t]);

  const loadCargos = useCallback(async () => {
    if (!companyId) {
      return;
    }
    try {
      const subs = await apiJson<CargosSubRow[]>(
        `/integrations/cargos/submissions?companyId=${encodeURIComponent(companyId)}`,
      );
      setCargosByRes(latestCargosByReservation(subs));
    } catch {
      setCargosByRes(new Map());
    }
  }, [companyId]);

  useEffect(() => {
    if (!ready || !companyId) {
      return;
    }
    void loadRows();
    void loadCargos();
  }, [ready, companyId, loadRows, loadCargos]);

  function setView(next: OpsView) {
    if (!companyId) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('companyId', companyId);
    params.set('view', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  if (meLoading) {
    return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  }
  if (meErr) {
    return <p className="desk-err">{meErr}</p>;
  }
  if (!me) {
    return null;
  }
  if (scopeErr) {
    return <p className="desk-err">{scopeErr}</p>;
  }
  if (!ready) {
    return <p className="desk-muted">{t('desk.loadingGate')}</p>;
  }

  const resList = deskReservationsListPath(pathname);
  const em = t('desk.fleet.quote.emDash');

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.operations.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '44rem', fontSize: '0.92rem' }}>
        {t('desk.operations.lead')}{' '}
        <Link href={companyId ? `${resList}?${new URLSearchParams({ companyId }).toString()}` : resList}>
          {t('desk.operations.linkReservations')}
        </Link>
      </p>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={onCompanyScopeChange}
      />
      {companyId && (
        <div
          className="desk-tool"
          style={{
            marginTop: '0.65rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <span className="desk-muted" style={{ fontSize: '0.88rem', marginRight: '0.25rem' }}>
            {t('desk.operations.viewLabel')}
          </span>
          <button type="button" className={view === 'active' ? undefined : 'desk-muted'} onClick={() => setView('active')}>
            {t('desk.operations.viewActive')}
          </button>
          <button type="button" className={view === 'returned' ? undefined : 'desk-muted'} onClick={() => setView('returned')}>
            {t('desk.operations.viewReturned')}
          </button>
        </div>
      )}
      {companyId && (
        <ReservationForm
          me={me}
          companyId={companyId}
          open={formOpen}
          editingId={editingId}
          onClose={closeForm}
          onSaved={() => {
            void loadRows();
            void loadCargos();
          }}
        />
      )}
      {err && <p className="desk-err">{err}</p>}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && companyId && rows.length === 0 && !err && (
        <p className="desk-muted">{t('desk.operations.empty')}</p>
      )}
      {!loading && rows.length > 0 && (
        <div className="desk-table-wrap" style={{ marginTop: '0.75rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.reservations.th.status')}</th>
                <th>{t('desk.reservations.th.customer')}</th>
                <th>{t('desk.reservations.th.period')}</th>
                <th>{t('desk.reservations.th.vehicle')}</th>
                <th>{t('desk.reservations.th.pickup')}</th>
                <th title={t('desk.reservations.th.odoTitle')}>{t('desk.reservations.th.odo')}</th>
                <th title={t('desk.reservations.th.agreementTitle')}>{t('desk.reservations.th.agreement')}</th>
                <th title={t('desk.reservations.th.damageTitle')}>{t('desk.reservations.th.damage')}</th>
                <th>{t('desk.reservations.th.cargos')}</th>
                <th>{t('desk.reservations.th.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = cargosByRes.get(r.id);
                const agr = r.rentalAgreement ? agreementOpsCell(r.rentalAgreement, t) : null;
                const dmg = damageOpsCell(r.damageReport, t);
                return (
                  <tr key={r.id}>
                    <td>{formatDeskReservationStatus(r.status, t)}</td>
                    <td>{r.customerName}</td>
                    <td>
                      {fmt(r.pickupAt)} → {fmt(r.returnAt)}
                    </td>
                    <td>
                      <code>{r.vehicle.licensePlate}</code>
                      {r.vehicle.modelLabel && (
                        <span className="desk-muted"> · {r.vehicle.modelLabel}</span>
                      )}
                    </td>
                    <td>
                      {r.pickupStation.name} <code>{r.pickupStation.code}</code>
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                      {r.odometerOutKm != null || r.odometerInKm != null
                        ? `${r.odometerOutKm ?? em} / ${r.odometerInKm ?? em}`
                        : em}
                    </td>
                    <td>
                      {agr ? (
                        <code style={{ fontSize: '0.82rem' }} title={agr.title}>
                          {agr.short}
                        </code>
                      ) : (
                        <span className="desk-muted">{em}</span>
                      )}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.82rem' }} title={dmg.title}>
                        {dmg.short}
                      </code>
                    </td>
                    <td>
                      {c ? (
                        <span title={c.errorMessage ? translateDeskApiErrorLine(c.errorMessage) : c.createdAt}>
                          <span title={c.status}>{formatDeskCargosSubmissionStatus(c.status, t)}</span>
                        </span>
                      ) : (
                        <span className="desk-muted">{em}</span>
                      )}
                    </td>
                    <td>
                      <div className="desk-table-actions">
                        <button type="button" onClick={() => openEdit(r.id)}>
                          {t('desk.reservations.action.edit')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="desk-muted" style={{ marginTop: '1rem', fontSize: '0.82rem' }}>
        {t('desk.operations.footerStatuses').replace(
          '{active}',
          ACTIVE_STATUSES.map((s) => formatDeskReservationStatus(s, t)).join(', '),
        )}
        {' · '}
        {t('desk.operations.footerReturned').replace(
          '{s}',
          formatDeskReservationStatus('COMPLETED', t),
        )}
      </p>
    </div>
  );
}

function OperationsSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return <p className="desk-muted">{t('desk.loadingGate')}</p>;
}

export default function OperationsPage() {
  return (
    <Suspense fallback={<OperationsSuspenseFallback />}>
      <OperationsPageContent />
    </Suspense>
  );
}
