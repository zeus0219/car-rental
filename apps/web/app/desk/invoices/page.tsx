'use client';

import { Fragment, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { createInvoiceSchema, updateInvoiceSchema, computeInvoiceAmounts } from '@car-rental/shared';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { translateDeskApiError, translateDeskApiErrorLine } from '../../../lib/desk-api-error-i18n';
import type { PublicLocale } from '../../../lib/public-locale';
import type { PublicMessageKey } from '../../../lib/public-messages';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';
import type { Me } from '../../../lib/me-types';

type InvoiceRow = {
  id: string;
  companyId: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  documentNumber: string | null;
  subtotalCents: number;
  vatRateBps: number;
  vatCents: number;
  totalCents: number;
  currency: string;
  description: string | null;
  issuedAt: string | null;
  reservationId: string | null;
  reservation: { id: string; customerName: string } | null;
  creditedInvoice: { id: string; documentNumber: string | null; kind: string; status: string } | null;
  createdAt: string;
  sdiSubmissions: {
    id: string;
    status: string;
    idTracciatura: string | null;
    errorMessage: string | null;
    processedAt: string | null;
  }[];
};

type CompanyFiscalBrief = {
  name: string;
  fiscalCode: string | null;
  vatNumber: string | null;
  sdiRecipientCode: string | null;
  pec: string | null;
};

type InvoiceDetail = InvoiceRow & {
  company: CompanyFiscalBrief;
  reservation: {
    id: string;
    customerName: string | null;
    status: string;
    customer: {
      id: string;
      name: string;
      email: string;
      fiscalCode: string | null;
      vatNumber: string | null;
      sdiRecipientCode: string | null;
      pec: string | null;
    } | null;
  } | null;
};

type ReservationForInvoicePrefill = {
  id: string;
  companyId: string;
  totalCents: number | null;
  customerName: string;
  currency: string;
};

const RESERVATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function FiscalFieldGrid(props: {
  t: (k: PublicMessageKey) => string;
  nameHeading?: string | null;
  email?: string | null | undefined;
  fiscalCode: string | null | undefined;
  vatNumber: string | null | undefined;
  sdiRecipientCode: string | null | undefined;
  pec: string | null | undefined;
}) {
  const { t, nameHeading, email, fiscalCode, vatNumber, sdiRecipientCode, pec } = props;
  const dash = () => t('desk.invoices.fiscalSnapshot.none');
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: '12rem 1fr',
        gap: '0.2rem 0.75rem',
        fontSize: '0.9em',
        alignItems: 'baseline',
      }}
    >
      {nameHeading != null && nameHeading !== '' && (
        <>
          <dt className="desk-muted">{t('desk.invoices.fiscalSnapshot.displayName')}</dt>
          <dd style={{ margin: 0 }}>{nameHeading}</dd>
        </>
      )}
      {email != null && email !== '' && (
        <>
          <dt className="desk-muted">{t('desk.customers.th.email')}</dt>
          <dd style={{ margin: 0 }}>{email}</dd>
        </>
      )}
      <dt className="desk-muted">{t('desk.customers.form.fiscalCode')}</dt>
      <dd style={{ margin: 0 }}>{fiscalCode?.trim() ? fiscalCode : dash()}</dd>
      <dt className="desk-muted">{t('desk.customers.form.vat')}</dt>
      <dd style={{ margin: 0 }}>{vatNumber?.trim() ? vatNumber : dash()}</dd>
      <dt className="desk-muted">{t('desk.customers.form.sdi')}</dt>
      <dd style={{ margin: 0 }}>{sdiRecipientCode?.trim() ? sdiRecipientCode : dash()}</dd>
      <dt className="desk-muted">{t('desk.customers.form.pec')}</dt>
      <dd style={{ margin: 0 }}>{pec?.trim() ? pec : dash()}</dd>
    </dl>
  );
}

function sdiSentOk(r: InvoiceRow): boolean {
  const s = r.sdiSubmissions[0];
  return Boolean(s && (s.status === 'MOCK_SENT' || s.status === 'SENT'));
}

function sdiEnqueueBlocked(r: InvoiceRow): boolean {
  const s = r.sdiSubmissions[0];
  if (!s) return false;
  return s.status === 'PROCESSING' || s.status === 'PENDING';
}

function canWriteInvoices(me: Me): boolean {
  return me.role !== 'READONLY_ACCOUNTING';
}

function formatMoney(cents: number, currency: string, kind: string): string {
  const n = (cents / 100).toFixed(2);
  const sign = kind === 'CREDIT_NOTE' && cents > 0 ? '−' : '';
  return `${sign}${n} ${currency}`;
}

function euroToCents(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  if (Number.isNaN(v) || v < 0) return null;
  return Math.round(v * 100);
}

function centsToEuroInput(c: number): string {
  return (c / 100).toFixed(2);
}

function formatIssuedAt(iso: string, locale: PublicLocale): string {
  const tag = locale === 'it' ? 'it-IT' : 'en-GB';
  try {
    return new Date(iso).toLocaleString(tag);
  } catch {
    return iso;
  }
}

const INVOICE_STATUS_KEYS: Record<string, PublicMessageKey> = {
  DRAFT: 'desk.invoices.status.DRAFT',
  ISSUED: 'desk.invoices.status.ISSUED',
  VOID: 'desk.invoices.status.VOID',
};

function formatInvoiceStatus(status: string, t: (k: PublicMessageKey) => string): string {
  const key = INVOICE_STATUS_KEYS[status];
  return key ? t(key) : status;
}

const SDI_SUBMISSION_STATUS_KEYS: Record<string, PublicMessageKey> = {
  PENDING: 'desk.invoices.sdi.status.PENDING',
  PROCESSING: 'desk.invoices.sdi.status.PROCESSING',
  MOCK_SENT: 'desk.invoices.sdi.status.MOCK_SENT',
  SKIPPED: 'desk.invoices.sdi.status.SKIPPED',
  FAILED: 'desk.invoices.sdi.status.FAILED',
  SENT: 'desk.invoices.sdi.status.SENT',
};

function formatSdiSubmissionStatus(status: string, t: (k: PublicMessageKey) => string): string {
  const key = SDI_SUBMISSION_STATUS_KEYS[status];
  return key ? t(key) : status;
}

function formatInvoiceKind(kind: string, t: (k: PublicMessageKey) => string): string {
  if (kind === 'INVOICE') {
    return t('desk.invoices.kind.invoice');
  }
  if (kind === 'CREDIT_NOTE') {
    return t('desk.invoices.kind.creditNote');
  }
  return kind;
}

function InvoicesPageContent() {
  const { t, locale } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const searchParams = useSearchParams();
  const openInvoiceId = searchParams.get('open');
  const autoOpenedInvoiceRef = useRef<string | null>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [q, setQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'DRAFT' | 'ISSUED' | 'VOID'>('');
  const [filterKind, setFilterKind] = useState<'' | 'INVOICE' | 'CREDIT_NOTE'>('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [invoiceActionErr, setInvoiceActionErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<'INVOICE' | 'CREDIT_NOTE'>('INVOICE');
  const [reservationId, setReservationId] = useState('');
  const [creditedInvoiceId, setCreditedInvoiceId] = useState('');
  const [subtotalEur, setSubtotalEur] = useState('0.00');
  const [vatBps, setVatBps] = useState('2200');
  const [description, setDescription] = useState('');
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [editSubtotal, setEditSubtotal] = useState('');
  const [editVat, setEditVat] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editReservationId, setEditReservationId] = useState('');
  const [companyStrip, setCompanyStrip] = useState<CompanyFiscalBrief | null>(null);
  const [fiscalOpenId, setFiscalOpenId] = useState<string | null>(null);
  const [fiscalDetail, setFiscalDetail] = useState<InvoiceDetail | null>(null);
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [resPrefillBusy, setResPrefillBusy] = useState(false);

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
    if (!openInvoiceId || !RESERVATION_UUID_RE.test(openInvoiceId)) {
      autoOpenedInvoiceRef.current = null;
      return;
    }
    if (!ready || !companyId) {
      return;
    }
    const qpCo = searchParams.get('companyId');
    if (qpCo && qpCo !== companyId) {
      return;
    }
    if (autoOpenedInvoiceRef.current === openInvoiceId) {
      return;
    }
    autoOpenedInvoiceRef.current = openInvoiceId;

    let cancelled = false;
    void (async () => {
      setFiscalOpenId(openInvoiceId);
      setFiscalDetail(null);
      setFiscalLoading(true);
      setInvoiceActionErr(null);
      try {
        const d = await apiJson<InvoiceDetail>(`/invoices/${encodeURIComponent(openInvoiceId)}`);
        if (cancelled) return;
        if (d.companyId !== companyId) {
          setFiscalOpenId(null);
          setFiscalDetail(null);
          return;
        }
        setFiscalDetail(d);
      } catch (e) {
        if (!cancelled) {
          setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
          setFiscalOpenId(null);
          setFiscalDetail(null);
        }
      } finally {
        if (!cancelled) setFiscalLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openInvoiceId, ready, companyId, searchParams, t]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ companyId });
      const qTrim = qRef.current.trim();
      if (qTrim) qs.set('q', qTrim);
      if (filterStatus) qs.set('status', filterStatus);
      if (filterKind) qs.set('kind', filterKind);
      const list = await apiJson<InvoiceRow[]>(`/invoices?${qs.toString()}`);
      setRows(list);
      setLoadErr(null);
      setInvoiceActionErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, t, filterStatus, filterKind]);

  useEffect(() => {
    if (!companyId) {
      setCompanyStrip(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const c = await apiJson<CompanyFiscalBrief & { id: string }>(
          `/companies/${encodeURIComponent(companyId)}`,
        );
        if (!cancelled) {
          setCompanyStrip({
            name: c.name,
            fiscalCode: c.fiscalCode,
            vatNumber: c.vatNumber,
            sdiRecipientCode: c.sdiRecipientCode,
            pec: c.pec,
          });
        }
      } catch {
        if (!cancelled) setCompanyStrip(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void load();
  }, [ready, companyId, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!companyId || !me) return;
    setSubmitErr(null);
    setSaving(true);
    try {
      const c = euroToCents(subtotalEur);
      if (c == null) {
        setSubmitErr(t('desk.invoices.err.invalidSubtotal'));
        return;
      }
      const bps = parseInt(vatBps, 10);
      if (Number.isNaN(bps) || bps < 0) {
        setSubmitErr(t('desk.invoices.err.invalidVatBps'));
        return;
      }
      const body = {
        companyId,
        kind,
        subtotalCents: c,
        vatRateBps: bps,
        description: description.trim() || undefined,
        reservationId: reservationId.trim() || undefined,
        creditedInvoiceId: kind === 'CREDIT_NOTE' ? creditedInvoiceId.trim() || undefined : undefined,
        currency: 'EUR',
      };
      const p = createInvoiceSchema.safeParse(body);
      if (!p.success) {
        setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
        return;
      }
      await apiJson('/invoices', { method: 'POST', body: JSON.stringify(p.data) });
      setFormOpen(false);
      setSubtotalEur('0.00');
      setDescription('');
      setReservationId('');
      setCreditedInvoiceId('');
      setKind('INVOICE');
      void load();
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function onUpdateEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitErr(null);
    setSaving(true);
    try {
      const c = euroToCents(editSubtotal);
      if (c == null) {
        setSubmitErr(t('desk.invoices.err.invalidSubtotal'));
        return;
      }
      const bps = parseInt(editVat, 10);
      if (Number.isNaN(bps) || bps < 0) {
        setSubmitErr(t('desk.invoices.err.invalidVat'));
        return;
      }
      const resTrim = editReservationId.trim();
      const reservationIdPatch: string | null = resTrim === '' ? null : resTrim;
      if (reservationIdPatch !== null && !RESERVATION_UUID_RE.test(reservationIdPatch)) {
        setSubmitErr(t('desk.invoices.err.invalidReservationId'));
        return;
      }
      const p = updateInvoiceSchema.safeParse({
        subtotalCents: c,
        vatRateBps: bps,
        description: editDesc.trim() || null,
        reservationId: reservationIdPatch,
      });
      if (!p.success) {
        setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
        return;
      }
      await apiJson(`/invoices/${encodeURIComponent(editing.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(p.data),
      });
      setEditing(null);
      void load();
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  const canWrite = me ? canWriteInvoices(me) : false;
  const prevSub = Math.round((parseFloat(subtotalEur.replace(',', '.')) || 0) * 100);
  const prevBps = parseInt(vatBps, 10);
  const preview = computeInvoiceAmounts(
    Number.isNaN(prevSub) ? 0 : prevSub,
    Number.isNaN(prevBps) ? 0 : prevBps,
  );

  const tableColSpan = canWrite ? 7 : 6;

  async function toggleFiscalSnapshot(id: string) {
    if (fiscalOpenId === id) {
      setFiscalOpenId(null);
      setFiscalDetail(null);
      return;
    }
    setInvoiceActionErr(null);
    setFiscalOpenId(id);
    setFiscalDetail(null);
    setFiscalLoading(true);
    try {
      const d = await apiJson<InvoiceDetail>(`/invoices/${encodeURIComponent(id)}`);
      setFiscalDetail(d);
    } catch (e) {
      setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
      setFiscalOpenId(null);
    } finally {
      setFiscalLoading(false);
    }
  }

  async function applyReservationTotalToDraft() {
    setSubmitErr(null);
    if (!companyId) return;
    const rid = reservationId.trim();
    if (!RESERVATION_UUID_RE.test(rid)) {
      setSubmitErr(t('desk.invoices.err.invalidReservationId'));
      return;
    }
    setResPrefillBusy(true);
    try {
      const res = await apiJson<ReservationForInvoicePrefill>(
        `/reservations/${encodeURIComponent(rid)}`,
      );
      if (res.companyId !== companyId) {
        setSubmitErr(t('desk.invoices.err.reservationCompany'));
        return;
      }
      if (res.currency !== 'EUR') {
        setSubmitErr(t('desk.invoices.err.reservationCurrency'));
        return;
      }
      if (res.totalCents == null || res.totalCents < 0) {
        setSubmitErr(t('desk.invoices.err.reservationNoTotal'));
        return;
      }
      setSubtotalEur((res.totalCents / 100).toFixed(2));
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setResPrefillBusy(false);
    }
  }

  async function applyReservationTotalToEditDraft() {
    setSubmitErr(null);
    if (!companyId) return;
    const rid = editReservationId.trim();
    if (!RESERVATION_UUID_RE.test(rid)) {
      setSubmitErr(t('desk.invoices.err.invalidReservationId'));
      return;
    }
    setResPrefillBusy(true);
    try {
      const res = await apiJson<ReservationForInvoicePrefill>(
        `/reservations/${encodeURIComponent(rid)}`,
      );
      if (res.companyId !== companyId) {
        setSubmitErr(t('desk.invoices.err.reservationCompany'));
        return;
      }
      if (res.currency !== 'EUR') {
        setSubmitErr(t('desk.invoices.err.reservationCurrency'));
        return;
      }
      if (res.totalCents == null || res.totalCents < 0) {
        setSubmitErr(t('desk.invoices.err.reservationNoTotal'));
        return;
      }
      setEditSubtotal((res.totalCents / 100).toFixed(2));
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setResPrefillBusy(false);
    }
  }

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return null;
  if (scopeErr) return <p className="desk-err">{scopeErr}</p>;
  if (!ready) return <p className="desk-muted">{t('desk.loadingCompanies')}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.invoices.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '44rem' }}>
        {t('desk.invoices.intro')}
      </p>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={setCompanyId}
      />
      {companyId && companyStrip && (
        <aside
          className="desk-form-panel"
          style={{ marginTop: '0.75rem', padding: '0.75rem 1rem' }}
          aria-label={t('desk.organization.fiscal.aria')}
        >
          <strong>{t('desk.invoices.fiscalSnapshot.supplier')}</strong>
          <p className="desk-muted" style={{ margin: '0.35rem 0 0.5rem', fontSize: '0.9em' }}>
            {t('desk.invoices.fiscalStrip.blurb')}
          </p>
          <FiscalFieldGrid
            t={t}
            nameHeading={companyStrip.name}
            fiscalCode={companyStrip.fiscalCode}
            vatNumber={companyStrip.vatNumber}
            sdiRecipientCode={companyStrip.sdiRecipientCode}
            pec={companyStrip.pec}
          />
        </aside>
      )}
      <div className="desk-tool" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.invoices.searchLabel')}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            placeholder={t('desk.invoices.searchPlaceholder')}
            maxLength={200}
            style={{ minWidth: '12rem' }}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.invoices.filter.status')}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          >
            <option value="">{t('desk.invoices.filter.any')}</option>
            <option value="DRAFT">{formatInvoiceStatus('DRAFT', t)}</option>
            <option value="ISSUED">{formatInvoiceStatus('ISSUED', t)}</option>
            <option value="VOID">{formatInvoiceStatus('VOID', t)}</option>
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {t('desk.invoices.filter.kind')}
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}>
            <option value="">{t('desk.invoices.filter.any')}</option>
            <option value="INVOICE">{formatInvoiceKind('INVOICE', t)}</option>
            <option value="CREDIT_NOTE">{formatInvoiceKind('CREDIT_NOTE', t)}</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()}>
          {t('desk.invoices.apply')}
        </button>
        {canWrite && companyId && (
          <button type="button" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? t('desk.invoices.closeForm') : t('desk.invoices.newDocument')}
          </button>
        )}
      </div>

      {formOpen && companyId && canWrite && (
        <form className="desk-form desk-form-panel" onSubmit={onCreate} style={{ marginTop: '0.75rem' }}>
          <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('desk.invoices.form.newDraft')}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <label>
              {t('desk.invoices.form.kindLabel')}
              <select value={kind} onChange={(e) => setKind(e.target.value as 'INVOICE' | 'CREDIT_NOTE')}>
                <option value="INVOICE">{t('desk.invoices.kind.invoice')}</option>
                <option value="CREDIT_NOTE">{t('desk.invoices.kind.creditNote')}</option>
              </select>
            </label>
            <label>
              {t('desk.invoices.form.subtotalExVat')}
              <input
                value={subtotalEur}
                onChange={(e) => setSubtotalEur(e.target.value)}
                inputMode="decimal"
                required
                style={{ width: '8rem' }}
              />
            </label>
            <label>
              {t('desk.invoices.form.vatBps')}
              <input
                value={vatBps}
                onChange={(e) => setVatBps(e.target.value)}
                maxLength={6}
                style={{ width: '5rem' }}
                title={t('desk.invoices.form.vatBpsTitle')}
              />
            </label>
            <span className="desk-muted" style={{ alignSelf: 'flex-end' }}>
              {t('desk.invoices.form.previewVatTotal')
                .replace('{vat}', (preview.vatCents / 100).toFixed(2))
                .replace('{total}', (preview.totalCents / 100).toFixed(2))}
            </span>
          </div>
          {kind === 'CREDIT_NOTE' && (
            <label>
              {t('desk.invoices.form.creditedInvoiceId')}
              <input
                value={creditedInvoiceId}
                onChange={(e) => setCreditedInvoiceId(e.target.value)}
                placeholder={t('desk.invoices.form.creditedInvoicePlaceholder')}
                style={{ width: '100%', maxWidth: '28rem', fontFamily: 'ui-monospace, monospace' }}
                required={kind === 'CREDIT_NOTE'}
              />
            </label>
          )}
          <div>
            <label>
              {t('desk.invoices.form.reservationIdOptional')}
              <input
                value={reservationId}
                onChange={(e) => setReservationId(e.target.value)}
                placeholder={t('form.placeholder.uuid')}
                style={{ width: '100%', maxWidth: '28rem', fontFamily: 'ui-monospace, monospace' }}
              />
            </label>
            {kind === 'INVOICE' && (
              <div style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  disabled={resPrefillBusy}
                  title={t('desk.invoices.form.loadFromReservationHint')}
                  onClick={() => void applyReservationTotalToDraft()}
                >
                  {resPrefillBusy
                    ? t('desk.invoices.fiscalSnapshot.loading')
                    : t('desk.invoices.form.loadFromReservation')}
                </button>
              </div>
            )}
          </div>
          <label>
            {t('desk.invoices.form.description')}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={8000}
              rows={2}
              style={{ width: '100%', maxWidth: '32rem' }}
            />
          </label>
          {submitErr && <p className="desk-err">{submitErr}</p>}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('desk.invoices.form.creating') : t('desk.invoices.form.createDraft')}
            </button>
          </div>
        </form>
      )}

      {editing && canWrite && (
        <form
          className="desk-form desk-form-panel"
          onSubmit={onUpdateEdit}
          style={{ marginTop: '0.75rem' }}
        >
          <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
            {t('desk.invoices.edit.title').replace('{id}', editing.id.slice(0, 8))}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <label>
              {t('desk.invoices.edit.subtotalEur')}
              <input
                value={editSubtotal}
                onChange={(e) => setEditSubtotal(e.target.value)}
                inputMode="decimal"
                required
                style={{ width: '8rem' }}
              />
            </label>
            <label>
              {t('desk.invoices.edit.vatBps')}
              <input
                value={editVat}
                onChange={(e) => setEditVat(e.target.value)}
                maxLength={6}
                style={{ width: '5rem' }}
              />
            </label>
          </div>
          <div>
            <label>
              {t('desk.invoices.form.reservationIdOptional')}
              <input
                value={editReservationId}
                onChange={(e) => setEditReservationId(e.target.value)}
                placeholder={t('form.placeholder.uuid')}
                style={{ width: '100%', maxWidth: '28rem', fontFamily: 'ui-monospace, monospace' }}
              />
            </label>
            {editing.kind === 'INVOICE' && (
              <div style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  disabled={resPrefillBusy}
                  title={t('desk.invoices.form.loadFromReservationHint')}
                  onClick={() => void applyReservationTotalToEditDraft()}
                >
                  {resPrefillBusy
                    ? t('desk.invoices.fiscalSnapshot.loading')
                    : t('desk.invoices.form.loadFromReservation')}
                </button>
              </div>
            )}
          </div>
          <label>
            {t('desk.invoices.form.description')}
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={8000}
              rows={2}
            />
          </label>
          {submitErr && <p className="desk-err">{submitErr}</p>}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {t('desk.invoices.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setEditReservationId('');
              }}
              disabled={saving}
            >
              {t('desk.invoices.cancel')}
            </button>
          </div>
        </form>
      )}

      {loadErr && <p className="desk-err">{loadErr}</p>}
      {invoiceActionErr && <p className="desk-err">{invoiceActionErr}</p>}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && rows.length === 0 && !loadErr && <p className="desk-muted">{t('desk.invoices.empty')}</p>}
      {rows.length > 0 && (
        <div className="desk-table-wrap" style={{ marginTop: '0.75rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.invoices.th.numberStatus')}</th>
                <th>{t('desk.invoices.th.kind')}</th>
                <th>{t('desk.invoices.th.totalInclVat')}</th>
                <th>{t('desk.invoices.th.reservation')}</th>
                <th>{t('desk.invoices.th.issued')}</th>
                <th>{t('desk.invoices.th.sdi')}</th>
                {canWrite && <th>{t('desk.invoices.th.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                  <td>
                    <code style={{ fontFamily: 'ui-monospace, monospace' }} title={r.id}>
                      {r.documentNumber ?? t('desk.invoices.noNumberDraft')}
                    </code>
                    <br />
                    <span className="desk-muted" style={{ fontSize: '0.85em' }}>
                      {formatInvoiceStatus(r.status, t)}
                    </span>
                    <div style={{ marginTop: '0.35rem' }}>
                      <button
                        type="button"
                        className="desk-muted"
                        style={{
                          fontSize: '0.85em',
                          padding: '0.15rem 0.35rem',
                          cursor: 'pointer',
                          background: 'transparent',
                          border: '1px solid var(--desk-border, #ccc)',
                          borderRadius: 4,
                        }}
                        onClick={() => void toggleFiscalSnapshot(r.id)}
                      >
                        {fiscalOpenId === r.id
                          ? t('desk.invoices.fiscalSnapshot.hide')
                          : t('desk.invoices.fiscalSnapshot.toggle')}
                      </button>
                    </div>
                  </td>
                  <td>
                    {formatInvoiceKind(r.kind, t)}
                    {r.creditedInvoice && (
                      <span className="desk-muted" style={{ display: 'block', fontSize: '0.85em' }}>
                        → {r.creditedInvoice.documentNumber ?? r.creditedInvoice.id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td>
                    {formatMoney(r.totalCents, r.currency, r.kind)}
                    <span className="desk-muted" style={{ display: 'block', fontSize: '0.85em' }}>
                      {t('desk.invoices.breakdown')
                        .replace('{net}', (r.subtotalCents / 100).toFixed(2))
                        .replace('{vat}', (r.vatCents / 100).toFixed(2))
                        .replace('{rate}', String(r.vatRateBps / 100))}
                    </span>
                  </td>
                  <td>
                    {r.reservation ? (
                      <span title={r.reservation.id}>
                        {r.reservation.customerName}{' '}
                        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85em' }}>{r.reservation.id.slice(0, 8)}</code>…
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="desk-muted" style={{ fontSize: '0.9em' }}>
                    {r.issuedAt ? formatIssuedAt(r.issuedAt, locale) : '—'}
                  </td>
                  <td style={{ fontSize: '0.9em' }}>
                    {r.sdiSubmissions[0] ? (
                      <span className="desk-muted" title={r.sdiSubmissions[0].status}>
                        {formatSdiSubmissionStatus(r.sdiSubmissions[0].status, t)}
                        {r.sdiSubmissions[0].idTracciatura && (
                          <>
                            <br />
                            <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8em' }}>
                              {r.sdiSubmissions[0].idTracciatura}
                            </code>
                          </>
                        )}
                        {r.sdiSubmissions[0].errorMessage && r.sdiSubmissions[0].status === 'FAILED' && (
                          <span
                            title={translateDeskApiErrorLine(r.sdiSubmissions[0].errorMessage)}
                            style={{ display: 'block' }}
                          >
                            {t('desk.invoices.sdiErrorHint')}
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                    {canWrite && r.status === 'ISSUED' && !sdiSentOk(r) && !sdiEnqueueBlocked(r) && (
                      <div style={{ marginTop: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(t('desk.invoices.confirm.queueSdi'))) return;
                            try {
                              await apiJson('/integrations/sdi/enqueue', {
                                method: 'POST',
                                body: JSON.stringify({ invoiceId: r.id }),
                              });
                              void load();
                            } catch (e) {
                              setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
                            }
                          }}
                        >
                          {t('desk.invoices.action.queueSdi')}
                        </button>
                      </div>
                    )}
                  </td>
                  {canWrite && (
                    <td>
                      <div className="desk-table-actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        {r.status === 'DRAFT' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSubmitErr(null);
                                setEditing(r);
                                setEditSubtotal(centsToEuroInput(r.subtotalCents));
                                setEditVat(String(r.vatRateBps));
                                setEditDesc(r.description ?? '');
                                setEditReservationId(r.reservationId ?? r.reservation?.id ?? '');
                              }}
                            >
                              {t('desk.invoices.action.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(t('desk.invoices.confirm.issue'))) return;
                                try {
                                  await apiJson(`/invoices/${encodeURIComponent(r.id)}/issue`, { method: 'POST' });
                                  void load();
                                } catch (e) {
                                  setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
                                }
                              }}
                            >
                              {t('desk.invoices.action.issue')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(t('desk.invoices.confirm.deleteDraft'))) return;
                                try {
                                  await apiJson(`/invoices/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
                                  void load();
                                } catch (e) {
                                  setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
                                }
                              }}
                            >
                              {t('desk.invoices.action.delete')}
                            </button>
                          </>
                        )}
                        {r.status === 'ISSUED' && r.kind === 'INVOICE' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSubmitErr(null);
                              setFormOpen(true);
                              setKind('CREDIT_NOTE');
                              setCreditedInvoiceId(r.id);
                              setReservationId(r.reservationId ?? r.reservation?.id ?? '');
                              setSubtotalEur(centsToEuroInput(r.subtotalCents));
                              setVatBps(String(r.vatRateBps));
                              setDescription(
                                t('desk.invoices.form.creditNoteDescriptionDefault').replace(
                                  '{num}',
                                  r.documentNumber ?? r.id.slice(0, 8),
                                ),
                              );
                            }}
                          >
                            {t('desk.invoices.action.creditFromIssued')}
                          </button>
                        )}
                        {r.status === 'ISSUED' && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(t('desk.invoices.confirm.void'))) return;
                              try {
                                await apiJson(`/invoices/${encodeURIComponent(r.id)}/void`, { method: 'POST' });
                                void load();
                              } catch (e) {
                                setInvoiceActionErr(e instanceof Error ? e.message : t('desk.err.generic'));
                              }
                            }}
                          >
                            {t('desk.invoices.action.void')}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                {fiscalOpenId === r.id && (
                  <tr className="desk-table-fiscal-expand">
                    <td colSpan={tableColSpan} style={{ background: 'var(--desk-subtle-bg, #f9f9f9)', padding: '0.75rem 1rem' }}>
                      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                        {t('desk.invoices.fiscalSnapshot.title')}
                      </h4>
                      {fiscalLoading && (
                        <p className="desk-muted" style={{ margin: 0 }}>
                          {t('desk.invoices.fiscalSnapshot.loading')}
                        </p>
                      )}
                      {!fiscalLoading && fiscalDetail && fiscalDetail.id === r.id && (
                        <div
                          style={{
                            display: 'grid',
                            gap: '1rem',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: '0.9em' }}>
                              {t('desk.invoices.fiscalSnapshot.supplier')}
                            </strong>
                            <div style={{ marginTop: '0.35rem' }}>
                              <FiscalFieldGrid
                                t={t}
                                nameHeading={fiscalDetail.company.name}
                                fiscalCode={fiscalDetail.company.fiscalCode}
                                vatNumber={fiscalDetail.company.vatNumber}
                                sdiRecipientCode={fiscalDetail.company.sdiRecipientCode}
                                pec={fiscalDetail.company.pec}
                              />
                            </div>
                          </div>
                          <div>
                            <strong style={{ fontSize: '0.9em' }}>
                              {t('desk.invoices.fiscalSnapshot.buyer')}
                            </strong>
                            {!fiscalDetail.reservation ? (
                              <p className="desk-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9em' }}>
                                {t('desk.invoices.fiscalSnapshot.noReservation')}
                              </p>
                            ) : (
                              <div style={{ marginTop: '0.35rem' }}>
                                <p className="desk-muted" style={{ margin: '0 0 0.35rem', fontSize: '0.85em' }}>
                                  {t('desk.invoices.fiscalSnapshot.reservationLead')}:{' '}
                                  <code style={{ fontFamily: 'ui-monospace, monospace' }}>{fiscalDetail.reservation.id}</code>
                                </p>
                                <FiscalFieldGrid
                                  t={t}
                                  nameHeading={
                                    fiscalDetail.reservation.customer?.name ??
                                    fiscalDetail.reservation.customerName ??
                                    null
                                  }
                                  email={fiscalDetail.reservation.customer?.email ?? null}
                                  fiscalCode={fiscalDetail.reservation.customer?.fiscalCode}
                                  vatNumber={fiscalDetail.reservation.customer?.vatNumber}
                                  sdiRecipientCode={fiscalDetail.reservation.customer?.sdiRecipientCode}
                                  pec={fiscalDetail.reservation.customer?.pec}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoicesSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return <p className="desk-muted">{t('desk.loadingGate')}</p>;
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<InvoicesSuspenseFallback />}>
      <InvoicesPageContent />
    </Suspense>
  );
}
