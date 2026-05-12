'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { canWriteCustomers, CustomerForm } from '../../../components/CustomerForm';
import { CustomerDocumentsPanel } from '../../../components/CustomerDocumentsPanel';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson, downloadApiJsonFile } from '../../../lib/api';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';
import type { Me } from '../../../lib/me-types';

type Row = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  phone: string;
  notes: string | null;
  fiscalCode: string | null;
  vatNumber: string | null;
  sdiRecipientCode: string | null;
  pec: string | null;
  anonymizedAt: string | null;
  _count: { reservations: number };
};

type OcrPendingDocItem = {
  id: string;
  docType: string;
  originalName: string;
  createdAt: string;
  ocrVendor: string | null;
  customer: { id: string; name: string; email: string };
};

function canExportGdprExport(m: Me): boolean {
  return (
    m.role === 'ADMIN' ||
    m.role === 'BRANCH_MANAGER' ||
    m.role === 'AGENT' ||
    m.role === 'READONLY_ACCOUNTING'
  );
}

function canAnonymizeCustomer(m: Me): boolean {
  return m.role === 'ADMIN' || m.role === 'BRANCH_MANAGER';
}

const CUSTOMER_OPEN_UUID_RE = /^[0-9a-f-]{36}$/i;

function CustomersPageContent() {
  const { t } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const searchParams = useSearchParams();
  const openCustomerId = searchParams.get('open');
  const ocrPendingFilter = useMemo(() => {
    const v = searchParams.get('ocrPending');
    return v === '1' || v?.toLowerCase() === 'true';
  }, [searchParams]);
  const docsCustomerId = searchParams.get('docs');
  const autoOpenedCustomerRef = useRef<string | null>(null);
  const autoOpenedDocsRef = useRef<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [docCustomerId, setDocCustomerId] = useState<string | null>(null);
  const [ocrReport, setOcrReport] = useState<{ limit: number; items: OcrPendingDocItem[] } | null>(null);
  const [ocrReportErr, setOcrReportErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  useEffect(() => {
    const cid = searchParams.get('companyId');
    if (!cid || companies.length === 0) {
      return;
    }
    if (companies.some((c) => c.id === cid)) {
      setCompanyId(cid);
    }
  }, [searchParams, companies, setCompanyId]);

  useEffect(() => {
    if (!openCustomerId || !CUSTOMER_OPEN_UUID_RE.test(openCustomerId)) {
      autoOpenedCustomerRef.current = null;
      return;
    }
    if (!ready || !companyId || !me) {
      return;
    }
    const qpCo = searchParams.get('companyId');
    if (qpCo && qpCo !== companyId) {
      return;
    }
    if (autoOpenedCustomerRef.current === openCustomerId) {
      return;
    }
    autoOpenedCustomerRef.current = openCustomerId;

    let cancelled = false;
    void (async () => {
      try {
        const c = await apiJson<{ id: string; companyId: string }>(
          `/customers/${encodeURIComponent(openCustomerId)}`,
        );
        if (cancelled) return;
        if (c.companyId !== companyId) {
          return;
        }
        setEditingId(openCustomerId);
        setFormOpen(true);
      } catch {
        if (!cancelled) {
          autoOpenedCustomerRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openCustomerId, ready, companyId, me, searchParams]);

  useEffect(() => {
    if (!docsCustomerId || !CUSTOMER_OPEN_UUID_RE.test(docsCustomerId)) {
      autoOpenedDocsRef.current = null;
      return;
    }
    if (!ready || !companyId || !me) {
      return;
    }
    const qpCo = searchParams.get('companyId');
    if (qpCo && qpCo !== companyId) {
      return;
    }
    if (autoOpenedDocsRef.current === docsCustomerId) {
      return;
    }
    autoOpenedDocsRef.current = docsCustomerId;

    let cancelled = false;
    void (async () => {
      try {
        const c = await apiJson<{ companyId: string }>(
          `/customers/${encodeURIComponent(docsCustomerId)}`,
        );
        if (cancelled) return;
        if (c.companyId !== companyId) {
          autoOpenedDocsRef.current = null;
          return;
        }
        setDocCustomerId(docsCustomerId);
      } catch {
        if (!cancelled) {
          autoOpenedDocsRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docsCustomerId, ready, companyId, me, searchParams]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ companyId });
      const trimmed = qRef.current.trim();
      if (trimmed) qs.set('q', trimmed);
      if (ocrPendingFilter) qs.set('ocrPending', '1');
      const list = await apiJson<Row[]>(`/customers?${qs.toString()}`);
      setRows(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
      setRows([]);
    } finally {
      setLoading(false);
    }
    if (!companyId || !ocrPendingFilter) {
      setOcrReport(null);
      setOcrReportErr(null);
      return;
    }
    try {
      const repQs = new URLSearchParams({ companyId, limit: '100' });
      const rep = await apiJson<{ companyId: string; limit: number; items: OcrPendingDocItem[] }>(
        `/reports/customer-documents-ocr-pending?${repQs.toString()}`,
      );
      setOcrReport({ limit: rep.limit, items: rep.items });
      setOcrReportErr(null);
    } catch (e) {
      setOcrReport(null);
      setOcrReportErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }, [companyId, t, ocrPendingFilter]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void load();
  }, [ready, companyId, load]);

  const canWrite = me ? canWriteCustomers(me) : false;

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return null;
  if (scopeErr) return <p className="desk-err">{scopeErr}</p>;
  if (!ready) return <p className="desk-muted">{t('desk.loadingCompanies')}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.nav.customers')}</h1>
      <p className="desk-muted" style={{ maxWidth: '42rem' }}>
        {t('desk.customers.intro')}
      </p>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={setCompanyId}
      />
      {ocrPendingFilter && (
        <p className="desk-muted" style={{ maxWidth: '42rem', marginTop: '0.5rem' }}>
          {t('desk.customers.ocrPending.banner')}{' '}
          <Link
            href={companyId ? `/desk/customers?companyId=${encodeURIComponent(companyId)}` : '/desk/customers'}
          >
            {t('desk.customers.ocrPending.clearLink')}
          </Link>
        </p>
      )}
      <div className="desk-tool" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.customers.searchLabel')}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            placeholder={t('desk.customers.searchPlaceholder')}
            maxLength={200}
            style={{ minWidth: '12rem' }}
          />
        </label>
        <button type="button" onClick={() => void load()}>
          {t('desk.customers.apply')}
        </button>
        {companyId && !ocrPendingFilter && (
          <Link href={`/desk/customers?companyId=${encodeURIComponent(companyId)}&ocrPending=1`}>
            {t('desk.customers.ocrPending.filterLink')}
          </Link>
        )}
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
          >
            {t('desk.customers.newCustomer')}
          </button>
        )}
      </div>
      {ocrPendingFilter && companyId && (
        <>
          <h2 className="desk-muted" style={{ fontSize: '1rem', margin: '1rem 0 0.35rem' }}>
            {t('desk.customers.ocrPending.queueTableTitle')}
          </h2>
          {ocrReportErr && <p className="desk-err">{ocrReportErr}</p>}
          {ocrReport && ocrReport.items.length === 0 && !ocrReportErr && (
            <p className="desk-muted">{t('desk.customers.ocrPending.queueEmpty')}</p>
          )}
          {ocrReport && ocrReport.items.length > 0 && (
            <div className="desk-table-wrap" style={{ marginTop: '0.35rem' }}>
              <table className="desk-table">
                <thead>
                  <tr>
                    <th>{t('desk.customers.ocrPending.th.customer')}</th>
                    <th>{t('desk.customers.ocrPending.th.email')}</th>
                    <th>{t('desk.customers.ocrPending.th.docType')}</th>
                    <th>{t('desk.customers.ocrPending.th.file')}</th>
                    <th>{t('desk.customers.ocrPending.th.queuedAt')}</th>
                    <th>{t('desk.customers.ocrPending.th.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrReport.items.map((d) => (
                    <tr key={d.id}>
                      <td>{d.customer.name}</td>
                      <td>
                        <code>{d.customer.email}</code>
                      </td>
                      <td>{d.docType}</td>
                      <td>{d.originalName}</td>
                      <td className="desk-muted" style={{ fontSize: '0.88rem' }}>
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <Link
                          href={`/desk/customers?companyId=${encodeURIComponent(companyId)}&ocrPending=1&docs=${encodeURIComponent(
                            d.customer.id,
                          )}`}
                        >
                          {t('desk.customers.ocrPending.openDocs')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {formOpen && companyId && (
        <CustomerForm
          me={me}
          companyId={companyId}
          open={formOpen}
          editingId={editingId}
          onClose={() => {
            setFormOpen(false);
            setEditingId(null);
          }}
          onSaved={() => {
            void load();
          }}
        />
      )}
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {actionErr && <p className="desk-err">{actionErr}</p>}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && rows.length === 0 && !loadErr && <p className="desk-muted">{t('desk.customers.empty')}</p>}
      {rows.length > 0 && (
        <div className="desk-table-wrap" style={{ marginTop: '0.75rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.customers.th.name')}</th>
                <th>{t('desk.customers.th.status')}</th>
                <th>{t('desk.customers.th.email')}</th>
                <th>{t('desk.customers.th.phone')}</th>
                <th>{t('desk.customers.th.fiscal')}</th>
                <th>{t('desk.customers.th.reservations')}</th>
                <th>{t('desk.customers.th.documents')}</th>
                <th>{t('desk.customers.th.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    {c.anonymizedAt ? (
                      <span className="desk-muted">{t('desk.customers.status.anonymized')}</span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td>
                    <code>{c.email}</code>
                  </td>
                  <td>{c.phone}</td>
                  <td>
                    <span className="desk-muted" style={{ fontSize: '0.9em' }} title={c.pec ?? undefined}>
                      {c.fiscalCode ??
                        c.vatNumber ??
                        (c.pec
                          ? c.pec.length > 28
                            ? `${c.pec.slice(0, 26)}…`
                            : c.pec
                          : c.sdiRecipientCode
                            ? t('desk.customers.sdiTag').replace('{code}', c.sdiRecipientCode)
                            : '—')}
                    </span>
                  </td>
                  <td>{c._count.reservations}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setDocCustomerId(docCustomerId === c.id ? null : c.id)}
                    >
                      {docCustomerId === c.id ? t('desk.customers.docClose') : t('desk.customers.docOpen')}
                    </button>
                  </td>
                  <td>
                    {(() => {
                      const hasActions =
                        canWrite || canExportGdprExport(me) || canAnonymizeCustomer(me);
                      const resFilter =
                        c._count.reservations > 0 ? (
                          <Link
                            href={`/desk/reservations?companyId=${encodeURIComponent(c.companyId)}&customerId=${encodeURIComponent(c.id)}`}
                          >
                            {t('desk.customers.link.reservations')}
                          </Link>
                        ) : null;
                      if (!resFilter && !hasActions) {
                        return '—';
                      }
                      return (
                        <div className="desk-table-actions" style={{ flexWrap: 'wrap' }}>
                          {resFilter}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(c.id);
                                setFormOpen(true);
                              }}
                            >
                              {t('desk.customers.action.edit')}
                            </button>
                          )}
                          {canExportGdprExport(me) && (
                            <button
                              type="button"
                              onClick={async () => {
                                setActionErr(null);
                                setActionBusy(true);
                                try {
                                  await downloadApiJsonFile(
                                    `/customers/${encodeURIComponent(c.id)}/gdpr/export`,
                                    `customer-${c.id}-gdpr.json`,
                                  );
                                } catch (e) {
                                  setActionErr(e instanceof Error ? e.message : t('desk.customers.err.exportFailed'));
                                } finally {
                                  setActionBusy(false);
                                }
                              }}
                              disabled={actionBusy}
                            >
                              {t('desk.customers.exportJson')}
                            </button>
                          )}
                          {canAnonymizeCustomer(me) && !c.anonymizedAt && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(t('desk.customers.confirm.anonymize'))) {
                                  return;
                                }
                                const reason = window.prompt(t('desk.customers.prompt.anonymizeReason')) ?? undefined;
                                setActionErr(null);
                                setActionBusy(true);
                                try {
                                  const body: { reason?: string } = {};
                                  if (reason && reason.trim()) body.reason = reason.trim().slice(0, 500);
                                  await apiJson(`/customers/${encodeURIComponent(c.id)}/gdpr/anonymize`, {
                                    method: 'POST',
                                    body: JSON.stringify(body),
                                  });
                                  void load();
                                } catch (e) {
                                  setActionErr(
                                    e instanceof Error ? e.message : t('desk.customers.err.anonymizeFailed'),
                                  );
                                } finally {
                                  setActionBusy(false);
                                }
                              }}
                              disabled={actionBusy}
                            >
                              {t('desk.customers.anonymize')}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {docCustomerId && companyId && (
        <CustomerDocumentsPanel
          me={me}
          companyId={companyId}
          customerId={docCustomerId}
          canWrite={canWrite}
          onClose={() => {
            autoOpenedDocsRef.current = null;
            setDocCustomerId(null);
          }}
          onCustomerMutated={() => void load()}
        />
      )}
    </div>
  );
}

function CustomersSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return <p className="desk-muted">{t('desk.loadingGate')}</p>;
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<CustomersSuspenseFallback />}>
      <CustomersPageContent />
    </Suspense>
  );
}
