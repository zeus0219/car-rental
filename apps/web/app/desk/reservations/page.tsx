'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { reservationStatusValues } from '@car-rental/shared';
import { canWriteReservations, ReservationForm } from '../../../components/ReservationForm';
import { ReservationStatusActions } from '../../../components/ReservationStatusActions';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { translateDeskApiErrorLine } from '../../../lib/desk-api-error-i18n';
import { formatDeskCargosSubmissionStatus } from '../../../lib/desk-cargos-submission-status';
import { formatDepositHoldStatus } from '../../../lib/desk-deposit-hold-label';
import { formatRentalAgreementStatus } from '../../../lib/desk-rental-agreement-status';
import { formatDeskReservationSource } from '../../../lib/desk-reservation-source-label';
import { formatDeskReservationStatus } from '../../../lib/desk-reservation-status-label';
import type { PublicMessageKey } from '../../../lib/public-messages';
import type { PublicLocale } from '../../../lib/public-locale';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type Res = {
  id: string;
  status: string;
  source: 'STAFF' | 'PUBLIC_WEB' | 'PARTNER';
  createdByPartnerApiKey?: { id: string; name: string } | null;
  pickupAt: string;
  returnAt: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalCents: number | null;
  currency: string;
  paidAt: string | null;
  depositHoldStatus: string;
  depositHoldCents: number | null;
  rentalAgreement: {
    id: string;
    status: string;
    agreementTemplateVersion: string | null;
    signedAt: string | null;
    signedByName: string | null;
    signedClientIp: string | null;
  } | null;
  vehicle: { licensePlate: string; modelLabel: string | null };
  pickupStation: { name: string; code: string };
  odometerOutKm: number | null;
  odometerInKm: number | null;
  extraLines?: { amountCents: number }[];
};

/** Latest per reservation; API list is ordered newest-first. */
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

function formatMoneyMinor(cents: number, currency: string, locale: PublicLocale): string {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  const c = (currency || 'EUR').toUpperCase();
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency: c }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${c}`;
  }
}

/** Same path depth as **`/desk/reservations`** (e.g. locale prefix) → **`/desk/customers`**. */
function deskCustomersListPath(reservationsPathname: string): string {
  return reservationsPathname.replace(/\/[^/]+$/, '/customers');
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function agreementListCell(
  r: Res['rentalAgreement'],
  t: (k: PublicMessageKey) => string,
): { short: string; title: string } {
  const dash = t('desk.fleet.quote.emDash');
  if (!r) {
    return { short: dash, title: t('desk.reservations.agreement.noAgreement') };
  }
  const ver = r.agreementTemplateVersion?.trim();
  const statusLabel = formatRentalAgreementStatus(r.status, t);
  const parts = [statusLabel];
  if (ver) {
    parts.push(ver);
  }
  const short = parts.join(' · ');
  const L = (key: PublicMessageKey, value: string) => t(key).replace('{value}', value);
  const titleLines = [
    L('desk.reservations.agreement.lineStatus', statusLabel),
    L('desk.reservations.agreement.lineTemplate', ver || dash),
    L('desk.reservations.agreement.lineSignedAt', r.signedAt || dash),
    L('desk.reservations.agreement.lineSignedAs', r.signedByName || dash),
    L('desk.reservations.agreement.lineClientIp', r.signedClientIp || dash),
  ];
  return { short, title: titleLines.join('\n') };
}

function downloadReservationsCsv(rows: Res[], companyId: string) {
  const headers = [
    'id',
    'status',
    'source',
    'partnerApiKeyId',
    'partnerApiKeyName',
    'customerId',
    'customerName',
    'customerEmail',
    'customerPhone',
    'pickupAt',
    'returnAt',
    'vehiclePlate',
    'totalCents',
    'currency',
    'paidAt',
    'pickupStationCode',
    'depositHoldStatus',
    'odometerOutKm',
    'odometerInKm',
    'agreementStatus',
    'agreementTemplateVersion',
    'agreementSignedAt',
    'agreementSignedByName',
    'agreementSignedClientIp',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const ra = r.rentalAgreement;
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.status),
        csvCell(r.source ?? 'STAFF'),
        csvCell(r.createdByPartnerApiKey?.id ?? ''),
        csvCell(r.createdByPartnerApiKey?.name ?? ''),
        csvCell(r.customerId),
        csvCell(r.customerName),
        csvCell(r.customerEmail),
        csvCell(r.customerPhone),
        csvCell(r.pickupAt),
        csvCell(r.returnAt),
        csvCell(r.vehicle.licensePlate),
        csvCell(r.totalCents),
        csvCell(r.currency),
        csvCell(r.paidAt),
        csvCell(r.pickupStation.code),
        csvCell(r.depositHoldStatus),
        csvCell(r.odometerOutKm),
        csvCell(r.odometerInKm),
        csvCell(ra?.status),
        csvCell(ra?.agreementTemplateVersion),
        csvCell(ra?.signedAt),
        csvCell(ra?.signedByName),
        csvCell(ra?.signedClientIp),
      ].join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reservations-${companyId.slice(0, 8)}.csv`;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(a.href);
}

type SourceFilter = '' | 'STAFF' | 'PUBLIC_WEB' | 'PARTNER';

function buildReservationsListHref(
  pathname: string,
  companyId: string,
  opts: {
    source: SourceFilter;
    status: (typeof reservationStatusValues)[number] | '';
    customerId?: string;
    open?: string;
  },
): string {
  const q = new URLSearchParams();
  q.set('companyId', companyId);
  if (opts.source) {
    q.set('source', opts.source);
  }
  if (opts.status) {
    q.set('status', opts.status);
  }
  if (opts.customerId && /^[0-9a-f-]{36}$/i.test(opts.customerId)) {
    q.set('customerId', opts.customerId);
  }
  if (opts.open && /^[0-9a-f-]{36}$/i.test(opts.open)) {
    q.set('open', opts.open);
  }
  return `${pathname}?${q.toString()}`;
}

function ReservationsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t, locale } = usePublicLocaleContext();
  const fmt = useMemo(() => makeFmtLocale(locale), [locale]);
  const customerIdInUrl = searchParams.get('customerId')?.trim() ?? '';
  const customerIdFilter = /^[0-9a-f-]{36}$/i.test(customerIdInUrl) ? customerIdInUrl : '';
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [rows, setRows] = useState<Res[]>([]);
  const [cargosByRes, setCargosByRes] = useState<Map<string, CargosSubRow>>(() => new Map());
  const [linkedCustomer, setLinkedCustomer] = useState<{ name: string; email: string } | null>(null);
  const [linkedCustomerResolved, setLinkedCustomerResolved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [statusFilter, setStatusFilter] = useState<(typeof reservationStatusValues)[number] | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [cargosQueueing, setCargosQueueing] = useState<string | null>(null);

  const canWrite = me ? canWriteReservations(me) : false;

  useEffect(() => {
    const s = searchParams.get('source');
    if (s === 'STAFF' || s === 'PUBLIC_WEB' || s === 'PARTNER') {
      setSourceFilter(s);
    } else {
      setSourceFilter('');
    }
    const st = searchParams.get('status');
    if (st && (reservationStatusValues as readonly string[]).includes(st)) {
      setStatusFilter(st as (typeof reservationStatusValues)[number]);
    } else {
      setStatusFilter('');
    }
  }, [searchParams]);

  const replaceListSearch = useCallback(
    (nextSource: SourceFilter, nextStatus: (typeof reservationStatusValues)[number] | '') => {
      if (!companyId) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('companyId', companyId);
      if (nextSource) {
        params.set('source', nextSource);
      } else {
        params.delete('source');
      }
      if (nextStatus) {
        params.set('status', nextStatus);
      } else {
        params.delete('status');
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [companyId, pathname, router, searchParams],
  );

  const onCompanyScopeChange = useCallback(
    (nextCompanyId: string) => {
      setCompanyId(nextCompanyId);
      const params = new URLSearchParams(searchParams.toString());
      params.set('companyId', nextCompanyId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams, setCompanyId],
  );

  /** Put **`companyId` in the address bar** when missing so the list view is bookmarkable (non-destructive). */
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

  /** E1: deep-link from reconciliation — `?companyId=` + `?open=<reservation uuid>` */
  useEffect(() => {
    const cid = searchParams.get('companyId');
    if (!cid || companies.length === 0) {
      return;
    }
    if (companies.some((c) => c.id === cid)) {
      setCompanyId(cid);
    }
  }, [searchParams, companies, setCompanyId]);

  const openReservationId = searchParams.get('open');
  const autoOpenedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !openReservationId ||
      !/^[0-9a-f-]{36}$/i.test(openReservationId) ||
      !ready ||
      !companyId
    ) {
      return;
    }
    const qpCo = searchParams.get('companyId');
    if (qpCo && qpCo !== companyId) {
      return;
    }
    if (autoOpenedRef.current === openReservationId) {
      return;
    }
    autoOpenedRef.current = openReservationId;
    setEditingId(openReservationId);
    setFormOpen(true);
  }, [openReservationId, ready, companyId, searchParams]);

  async function queueCargos(resId: string, sendImmediately = false) {
    setCargosQueueing(resId);
    setActionErr(null);
    try {
      await apiJson('/integrations/cargos/enqueue', {
        method: 'POST',
        body: JSON.stringify(
          sendImmediately ? { reservationId: resId, sendImmediately: true } : { reservationId: resId },
        ),
      });
      void loadCargos();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : t('desk.reservations.err.queueCargos'));
    } finally {
      setCargosQueueing(null);
    }
  }

  const loadReservations = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setLoading(true);
    try {
      const src =
        sourceFilter === '' ? '' : `&source=${encodeURIComponent(sourceFilter)}`;
      const st =
        statusFilter === '' ? '' : `&status=${encodeURIComponent(statusFilter)}`;
      const byCust =
        customerIdFilter === '' ? '' : `&customerId=${encodeURIComponent(customerIdFilter)}`;
      const list = await apiJson<Res[]>(
        `/reservations?companyId=${encodeURIComponent(companyId)}${src}${st}${byCust}`,
      );
      setRows(list);
      setErr(null);
      setActionErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, sourceFilter, statusFilter, customerIdFilter, t]);

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
      // Non-fatal: desk still works without CaRGOS column
      setCargosByRes(new Map());
    }
  }, [companyId]);

  useEffect(() => {
    if (!ready || !companyId) {
      return;
    }
    void loadReservations();
    void loadCargos();
  }, [ready, companyId, loadReservations, loadCargos]);

  useEffect(() => {
    if (!customerIdFilter || !companyId || !me) {
      setLinkedCustomer(null);
      setLinkedCustomerResolved(false);
      return;
    }
    let cancelled = false;
    setLinkedCustomerResolved(false);
    void (async () => {
      try {
        const c = await apiJson<{ companyId: string; name: string; email: string }>(
          `/customers/${encodeURIComponent(customerIdFilter)}`,
        );
        if (cancelled) {
          return;
        }
        if (c.companyId !== companyId) {
          setLinkedCustomer(null);
        } else {
          setLinkedCustomer({ name: c.name, email: c.email });
        }
      } catch {
        if (!cancelled) {
          setLinkedCustomer(null);
        }
      } finally {
        if (!cancelled) {
          setLinkedCustomerResolved(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerIdFilter, companyId, me]);

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
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

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.nav.reservations')}</h1>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={onCompanyScopeChange}
      />
      {companyId && customerIdFilter && linkedCustomerResolved && (
        <p className="desk-muted" style={{ marginTop: '0.65rem', maxWidth: '42rem', fontSize: '0.9rem' }}>
          {linkedCustomer
            ? t('desk.reservations.filterLinkedCustomer')
                .replace('{name}', linkedCustomer.name)
                .replace('{email}', linkedCustomer.email)
            : t('desk.reservations.filterLinkedFallback').replace('{id}', customerIdFilter)}{' '}
          <Link
            href={buildReservationsListHref(pathname, companyId, {
              source: sourceFilter,
              status: statusFilter,
              open:
                openReservationId && /^[0-9a-f-]{36}$/i.test(openReservationId)
                  ? openReservationId
                  : undefined,
            })}
          >
            {t('desk.reservations.clearCustomerFilter')}
          </Link>
          {' · '}
          <Link
            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({ companyId, open: customerIdFilter }).toString()}`}
          >
            {t('desk.reservations.backCustomers')}
          </Link>
          {' · '}
          <Link
            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({ companyId, docs: customerIdFilter }).toString()}`}
          >
            {t('desk.reservations.customerDocumentsLink')}
          </Link>
          {' · '}
          <Link
            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({
              companyId,
              ocrPending: '1',
              docs: customerIdFilter,
            }).toString()}`}
          >
            {t('desk.reservations.customerOcrDocsLink')}
          </Link>
        </p>
      )}
      {companyId && (
        <div
          className="desk-tool"
          style={{
            marginTop: '0.5rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.75rem 1.25rem',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            {t('desk.reservations.filterSource')}
            <select
              value={sourceFilter}
              onChange={(e) => {
                const v = e.target.value as SourceFilter;
                setSourceFilter(v);
                replaceListSearch(v, statusFilter);
              }}
            >
              <option value="">{t('desk.reservations.sourceAll')}</option>
              <option value="PUBLIC_WEB">{t('desk.reservations.sourcePublic')}</option>
              <option value="PARTNER">{t('desk.reservations.sourcePartner')}</option>
              <option value="STAFF">{t('desk.reservations.sourceStaff')}</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            {t('desk.reservations.filterStatus')}
            <select
              value={statusFilter}
              onChange={(e) => {
                const v =
                  e.target.value === ''
                    ? ''
                    : (e.target.value as (typeof reservationStatusValues)[number]);
                setStatusFilter(v);
                replaceListSearch(sourceFilter, v);
              }}
            >
              <option value="">{t('desk.reservations.sourceAll')}</option>
              {reservationStatusValues.map((x) => (
                <option key={x} value={x}>
                  {formatDeskReservationStatus(x, t)}
                </option>
              ))}
            </select>
          </label>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                downloadReservationsCsv(rows, companyId);
              }}
            >
              {t('desk.reservations.exportCsv')}
            </button>
          )}
          {(sourceFilter || statusFilter) && (
            <Link
              className="desk-muted"
              style={{ fontSize: '0.88rem' }}
              href={buildReservationsListHref(pathname, companyId, {
                source: '',
                status: '',
                customerId: customerIdFilter || undefined,
                open:
                  openReservationId && /^[0-9a-f-]{36}$/i.test(openReservationId)
                    ? openReservationId
                    : undefined,
              })}
            >
              {t('desk.reservations.clearListFilters')}
            </Link>
          )}
        </div>
      )}
      {canWrite && (
        <div className="desk-tool" style={{ marginTop: 0 }}>
          <button type="button" onClick={openCreate}>
            {t('desk.reservations.new')}
          </button>
          {!formOpen && (
            <span className="desk-muted">{t('desk.reservations.hintCreate')}</span>
          )}
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
            void loadReservations();
            void loadCargos();
          }}
        />
      )}
      {err && <p className="desk-err">{err}</p>}
      {actionErr && <p className="desk-err">{actionErr}</p>}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && rows.length === 0 && !err && (
        <>
          <p className="desk-muted">
            {sourceFilter || statusFilter || customerIdFilter
              ? t('desk.reservations.emptyFiltered')
              : t('desk.reservations.empty')}
            {canWrite
              ? ` ${sourceFilter || statusFilter || customerIdFilter ? t('desk.reservations.empty.suffixClearOr') : ''}${t('desk.reservations.empty.suffixNew')}`
              : ''}
          </p>
          {companyId && (sourceFilter || statusFilter || customerIdFilter) && (
            <p className="desk-tool" style={{ marginTop: '0.25rem', flexWrap: 'wrap', gap: '0.35rem' }}>
              {(sourceFilter || statusFilter) && (
                <Link
                  href={buildReservationsListHref(pathname, companyId, {
                    source: '',
                    status: '',
                    customerId: customerIdFilter || undefined,
                    open:
                      openReservationId && /^[0-9a-f-]{36}$/i.test(openReservationId)
                        ? openReservationId
                        : undefined,
                  })}
                >
                  {t('desk.reservations.clearListFilters')}
                </Link>
              )}
              {(sourceFilter || statusFilter) && customerIdFilter && <span className="desk-muted">·</span>}
              {customerIdFilter && (
                <Link
                  href={buildReservationsListHref(pathname, companyId, {
                    source: sourceFilter,
                    status: statusFilter,
                    open:
                      openReservationId && /^[0-9a-f-]{36}$/i.test(openReservationId)
                        ? openReservationId
                        : undefined,
                  })}
                >
                  {t('desk.reservations.clearCustomerFilter')}
                </Link>
              )}
            </p>
          )}
        </>
      )}
      {rows.length > 0 && (
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.reservations.th.status')}</th>
                <th>{t('desk.reservations.th.source')}</th>
                <th>{t('desk.reservations.th.partnerKey')}</th>
                <th>{t('desk.reservations.th.customer')}</th>
                <th>{t('desk.reservations.th.period')}</th>
                <th>{t('desk.reservations.th.vehicle')}</th>
                <th>{t('desk.reservations.th.pickup')}</th>
                <th title={t('desk.reservations.th.odoTitle')}>{t('desk.reservations.th.odo')}</th>
                <th>{t('desk.reservations.th.total')}</th>
                <th>{t('desk.reservations.th.paid')}</th>
                <th>{t('desk.reservations.th.deposit')}</th>
                <th>{t('desk.reservations.th.extras')}</th>
                <th title={t('desk.reservations.th.agreementTitle')}>{t('desk.reservations.th.agreement')}</th>
                <th>{t('desk.reservations.th.cargos')}</th>
                {canWrite && <th>{t('desk.reservations.th.quick')}</th>}
                {canWrite && <th>{t('desk.reservations.th.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = cargosByRes.get(r.id);
                const agr = r.rentalAgreement ? agreementListCell(r.rentalAgreement, t) : null;
                const em = t('desk.fleet.quote.emDash');
                const src = formatDeskReservationSource(r.source, t);
                return (
                  <tr key={r.id}>
                    <td>{formatDeskReservationStatus(r.status, t)}</td>
                    <td>
                      <span className={src.muted ? 'desk-muted' : undefined} title={src.title}>
                        {src.label}
                      </span>
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.88rem', maxWidth: '10rem' }} title={r.createdByPartnerApiKey?.id}>
                      {r.createdByPartnerApiKey?.name?.trim() ? r.createdByPartnerApiKey.name : em}
                    </td>
                    <td>
                      <span>{r.customerName}</span>
                      {r.customerId && companyId ? (
                        <>
                          {' · '}
                          <Link
                            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({
                              companyId,
                              open: r.customerId,
                            }).toString()}`}
                            className="desk-muted"
                            style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                          >
                            {t('desk.reservations.customerProfileLink')}
                          </Link>
                          {' · '}
                          <Link
                            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({
                              companyId,
                              docs: r.customerId,
                            }).toString()}`}
                            className="desk-muted"
                            style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                          >
                            {t('desk.reservations.customerDocumentsLink')}
                          </Link>
                          {' · '}
                          <Link
                            href={`${deskCustomersListPath(pathname)}?${new URLSearchParams({
                              companyId,
                              ocrPending: '1',
                              docs: r.customerId,
                            }).toString()}`}
                            className="desk-muted"
                            style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                          >
                            {t('desk.reservations.customerOcrDocsLink')}
                          </Link>
                        </>
                      ) : null}
                    </td>
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
                      {r.totalCents != null ? (
                        formatMoneyMinor(r.totalCents, r.currency, locale)
                      ) : (
                        em
                      )}
                    </td>
                    <td>
                      {r.paidAt ? (
                        <span className="desk-ok" title={r.paidAt}>
                          {fmt(r.paidAt)}
                        </span>
                      ) : (
                        <span className="desk-muted">{em}</span>
                      )}
                    </td>
                    <td>
                      {r.depositHoldStatus !== 'NONE' ? (
                        <span
                          title={[
                            formatDepositHoldStatus(r.depositHoldStatus, t),
                            r.depositHoldStatus,
                            r.depositHoldCents != null && r.depositHoldCents > 0
                              ? formatMoneyMinor(r.depositHoldCents, r.currency, locale)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          <code>{formatDepositHoldStatus(r.depositHoldStatus, t)}</code>
                          {r.depositHoldCents != null && r.depositHoldCents > 0 && (
                            <span className="desk-muted">
                              {' · '}
                              {formatMoneyMinor(r.depositHoldCents, r.currency, locale)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="desk-muted">{em}</span>
                      )}
                    </td>
                    <td>
                      {r.extraLines && r.extraLines.length > 0
                        ? formatMoneyMinor(
                            r.extraLines.reduce((s, x) => s + x.amountCents, 0),
                            r.currency,
                            locale,
                          )
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
                      <div>
                        {c ? (
                          <span
                            title={
                              c.errorMessage ? translateDeskApiErrorLine(c.errorMessage) : c.createdAt
                            }
                          >
                            <span title={c.status}>
                              {formatDeskCargosSubmissionStatus(c.status, t)}
                            </span>
                          </span>
                        ) : (
                          <span className="desk-muted">{em}</span>
                        )}
                        {canWrite && r.status !== 'CANCELLED' && (
                          <div className="desk-table-actions" style={{ marginTop: '0.25rem', gap: '0.25rem' }}>
                            <button
                              type="button"
                              disabled={cargosQueueing !== null}
                              onClick={() => {
                                void queueCargos(r.id, false);
                              }}
                            >
                              {cargosQueueing === r.id ? t('desk.ui.buttonBusy') : t('desk.reservations.cargosQueue')}
                            </button>
                            <button
                              type="button"
                              disabled={cargosQueueing !== null}
                              title={t('desk.res.form.cargosSendNow')}
                              onClick={() => {
                                void queueCargos(r.id, true);
                              }}
                            >
                              {cargosQueueing === r.id ? t('desk.ui.buttonBusy') : t('desk.res.form.cargosSendNow')}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    {canWrite && (
                      <td>
                        <ReservationStatusActions
                          reservationId={r.id}
                          status={r.status}
                          onDone={() => {
                            setActionErr(null);
                            void loadReservations();
                            void loadCargos();
                          }}
                          onError={setActionErr}
                        />
                      </td>
                    )}
                    {canWrite && (
                      <td>
                        <div className="desk-table-actions">
                          <button type="button" onClick={() => openEdit(r.id)}>
                            {t('desk.reservations.action.edit')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReservationsSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return <p className="desk-muted">{t('desk.loadingGate')}</p>;
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={<ReservationsSuspenseFallback />}>
      <ReservationsPageContent />
    </Suspense>
  );
}
