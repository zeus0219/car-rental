'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  createCustomerSchema,
  mergeCustomerBodySchema,
  updateCustomerSchema,
  isValidItalianFiscalCode,
  isValidItalianVatNumber,
  normalizeItalianVatDigits,
} from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { formatDeskReservationSource } from '../lib/desk-reservation-source-label';
import { formatDeskReservationStatus } from '../lib/desk-reservation-status-label';
import type { PublicLocale } from '../lib/public-locale';
import type { Me } from '../lib/me-types';

type RecentReservation = {
  id: string;
  status: string;
  source: string;
  pickupAt: string;
  returnAt: string;
  totalCents: number | null;
  currency: string;
  vehicle: { licensePlate: string; vehicleClass: { name: string; code: string } };
};

type CustomerReservationsPage = {
  items: RecentReservation[];
  total: number;
  limit: number;
  offset: number;
};

type Customer = {
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
  privacyNoticeVersion: string | null;
  privacyNoticeAcceptedAt: string | null;
  marketingEmailOptIn: boolean;
  marketingOptInAt: string | null;
  anonymizedAt: string | null;
  recentReservations?: RecentReservation[];
  _count?: { reservations: number };
};

type PrivacyRegisterRow = {
  id: string;
  version: string;
  policyUrl: string | null;
  effectiveFrom: string | null;
  notes: string | null;
};

type FormValues = Omit<Customer, 'id' | 'companyId' | 'recentReservations'> & { privacyAcceptedLocal: string };

const empty: FormValues = {
  name: '',
  email: '',
  phone: '',
  notes: null,
  fiscalCode: null,
  vatNumber: null,
  sdiRecipientCode: null,
  pec: null,
  privacyNoticeVersion: null,
  privacyNoticeAcceptedAt: null,
  marketingEmailOptIn: false,
  marketingOptInAt: null,
  anonymizedAt: null,
  privacyAcceptedLocal: '',
};

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function localInputToIso(s: string): string | null {
  if (!s.trim()) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function emailLooksComplete(s: string): boolean {
  const t = s.trim();
  if (t.length < 5 || !t.includes('@')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/** B1 phone dedupe: API matches digits-only (E.164-ish length). */
function phoneDigitsCompleteForLookup(s: string): boolean {
  const n = s.replace(/\D/g, '').length;
  return n >= 8 && n <= 15;
}

function formatTripShort(pickupAt: string, returnAt: string, locale: PublicLocale): string {
  const tag = locale === 'it' ? 'it-IT' : 'en-GB';
  try {
    const o: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };
    return `${new Date(pickupAt).toLocaleString(tag, o)} → ${new Date(returnAt).toLocaleString(tag, o)}`;
  } catch {
    return `${pickupAt} → ${returnAt}`;
  }
}

export function canWriteCustomers(me: Me): boolean {
  return me.role !== 'READONLY_ACCOUNTING';
}

export function canMergeCustomers(me: Me): boolean {
  return me.role === 'ADMIN' || me.role === 'BRANCH_MANAGER';
}

type Props = {
  me: Me;
  companyId: string;
  open: boolean;
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function CustomerForm({ me, companyId, open, editingId, onClose, onSaved }: Props) {
  const { t, locale } = usePublicLocaleContext();
  const [values, setValues] = useState<FormValues>({ ...empty });
  const [recentReservations, setRecentReservations] = useState<RecentReservation[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailDupHint, setEmailDupHint] = useState<{ id: string; name: string } | null>(null);
  const [fiscalDupHint, setFiscalDupHint] = useState<{ id: string; name: string } | null>(null);
  const [vatDupHint, setVatDupHint] = useState<{ id: string; name: string } | null>(null);
  const [phoneDupHint, setPhoneDupHint] = useState<{ id: string; name: string } | null>(null);
  const [privacyRegister, setPrivacyRegister] = useState<PrivacyRegisterRow[]>([]);
  const [linkedReservationTotal, setLinkedReservationTotal] = useState<number | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [mergeIntoInput, setMergeIntoInput] = useState('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState<string | null>(null);
  const isEdit = Boolean(editingId);

  useEffect(() => {
    if (!open) return;
    setSubmitErr(null);
    if (!editingId) {
      setValues({ ...empty });
      setRecentReservations(null);
      setLoadErr(null);
      setEmailDupHint(null);
      setFiscalDupHint(null);
      setVatDupHint(null);
      setPhoneDupHint(null);
      setPrivacyRegister([]);
      setLinkedReservationTotal(null);
      setHistoryLoadingMore(false);
      setMergeIntoInput('');
      setMergeErr(null);
      setMergeBusy(false);
      return;
    }
    setLoading(true);
    setRecentReservations(null);
    void (async () => {
      try {
        const c = await apiJson<Customer>(`/customers/${encodeURIComponent(editingId)}`);
        setValues({
          name: c.name,
          email: c.email,
          phone: c.phone,
          notes: c.notes,
          fiscalCode: c.fiscalCode,
          vatNumber: c.vatNumber,
          sdiRecipientCode: c.sdiRecipientCode,
          pec: c.pec,
          privacyNoticeVersion: c.privacyNoticeVersion,
          privacyNoticeAcceptedAt: c.privacyNoticeAcceptedAt,
          privacyAcceptedLocal: isoToLocalInput(c.privacyNoticeAcceptedAt),
          marketingEmailOptIn: Boolean(c.marketingEmailOptIn),
          marketingOptInAt: c.marketingOptInAt,
          anonymizedAt: c.anonymizedAt,
        });
        setRecentReservations(Array.isArray(c.recentReservations) ? c.recentReservations : []);
        setLinkedReservationTotal(c._count?.reservations ?? null);
        setLoadErr(null);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, editingId, t]);

  useEffect(() => {
    if (!open) {
      setEmailDupHint(null);
      setFiscalDupHint(null);
      setVatDupHint(null);
      setPrivacyRegister([]);
      return;
    }
    let cancelled = false;
    const raw = values.email.trim();
    if (!raw || !emailLooksComplete(raw)) {
      setEmailDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, email: raw });
          if (isEdit && editingId) {
            qs.set('excludeCustomerId', editingId);
          }
          const r = await apiJson<{ match: { id: string; name: string; email: string } | null }>(
            `/customers/lookup-by-email?${qs.toString()}`,
          );
          if (!cancelled && r.match) {
            setEmailDupHint({ id: r.match.id, name: r.match.name });
          } else if (!cancelled) {
            setEmailDupHint(null);
          }
        } catch {
          if (!cancelled) {
            setEmailDupHint(null);
          }
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, values.email, companyId, isEdit, editingId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const raw = values.fiscalCode?.trim() ?? '';
    const key = raw.toUpperCase().replace(/\s/g, '');
    if (key.length !== 16 || !isValidItalianFiscalCode(key)) {
      setFiscalDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, fiscalCode: raw });
          if (isEdit && editingId) {
            qs.set('excludeCustomerId', editingId);
          }
          const r = await apiJson<{ match: { id: string; name: string } | null }>(
            `/customers/lookup-by-fiscal-code?${qs.toString()}`,
          );
          if (!cancelled && r.match) {
            setFiscalDupHint({ id: r.match.id, name: r.match.name });
          } else if (!cancelled) {
            setFiscalDupHint(null);
          }
        } catch {
          if (!cancelled) {
            setFiscalDupHint(null);
          }
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, values.fiscalCode, companyId, isEdit, editingId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const raw = values.vatNumber?.trim() ?? '';
    if (!raw || !normalizeItalianVatDigits(raw) || !isValidItalianVatNumber(raw)) {
      setVatDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, vatNumber: raw });
          if (isEdit && editingId) {
            qs.set('excludeCustomerId', editingId);
          }
          const r = await apiJson<{ match: { id: string; name: string } | null }>(
            `/customers/lookup-by-vat?${qs.toString()}`,
          );
          if (!cancelled && r.match) {
            setVatDupHint({ id: r.match.id, name: r.match.name });
          } else if (!cancelled) {
            setVatDupHint(null);
          }
        } catch {
          if (!cancelled) {
            setVatDupHint(null);
          }
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, values.vatNumber, companyId, isEdit, editingId]);

  useEffect(() => {
    if (!open) {
      setPhoneDupHint(null);
      return;
    }
    let cancelled = false;
    const raw = values.phone.trim();
    if (!raw || !phoneDigitsCompleteForLookup(raw)) {
      setPhoneDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, phone: raw });
          if (isEdit && editingId) {
            qs.set('excludeCustomerId', editingId);
          }
          const r = await apiJson<{ match: { id: string; name: string } | null }>(
            `/customers/lookup-by-phone?${qs.toString()}`,
          );
          if (!cancelled && r.match) {
            setPhoneDupHint({ id: r.match.id, name: r.match.name });
          } else if (!cancelled) {
            setPhoneDupHint(null);
          }
        } catch {
          if (!cancelled) {
            setPhoneDupHint(null);
          }
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, values.phone, companyId, isEdit, editingId]);

  useEffect(() => {
    if (!open || !isEdit || !companyId) {
      setPrivacyRegister([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await apiJson<PrivacyRegisterRow[]>(
          `/companies/${encodeURIComponent(companyId)}/privacy-notices`,
        );
        if (!cancelled) {
          setPrivacyRegister(Array.isArray(list) ? list : []);
        }
      } catch {
        if (!cancelled) {
          setPrivacyRegister([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, companyId]);

  if (!open) {
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    setSaving(true);
    try {
      if (isEdit && editingId) {
        const privacyV =
          values.privacyNoticeVersion === '' || values.privacyNoticeVersion == null
            ? null
            : values.privacyNoticeVersion.trim() || null;
        const acceptedFromLocal = localInputToIso(values.privacyAcceptedLocal);
        const p = updateCustomerSchema.safeParse({
          name: values.name,
          email: values.email,
          phone: values.phone,
          notes: values.notes === '' || values.notes == null ? null : values.notes,
          fiscalCode: values.fiscalCode === '' || values.fiscalCode == null ? null : values.fiscalCode,
          vatNumber: values.vatNumber === '' || values.vatNumber == null ? null : values.vatNumber,
          sdiRecipientCode:
            values.sdiRecipientCode === '' || values.sdiRecipientCode == null
              ? null
              : values.sdiRecipientCode,
          pec: values.pec === '' || values.pec == null ? null : values.pec,
          ...(privacyV === null
            ? { privacyNoticeVersion: null, privacyNoticeAcceptedAt: null }
            : {
                privacyNoticeVersion: privacyV,
                ...(acceptedFromLocal ? { privacyNoticeAcceptedAt: acceptedFromLocal } : {}),
              }),
          marketingEmailOptIn: values.marketingEmailOptIn,
        });
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        if (Object.keys(p.data).length === 0) {
          onClose();
          return;
        }
        await apiJson(`/customers/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          body: JSON.stringify(p.data),
        });
      } else {
        const p = createCustomerSchema.safeParse({
          companyId,
          name: values.name,
          email: values.email,
          phone: values.phone,
          notes: values.notes || undefined,
          fiscalCode: values.fiscalCode ?? undefined,
          vatNumber: values.vatNumber ?? undefined,
          sdiRecipientCode: values.sdiRecipientCode ?? undefined,
          pec: values.pec ?? undefined,
        });
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson('/customers', {
          method: 'POST',
          body: JSON.stringify(p.data),
        });
      }
      onSaved();
      onClose();
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function loadMoreReservationHistory() {
    if (!editingId || recentReservations == null || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const page = await apiJson<CustomerReservationsPage>(
        `/customers/${encodeURIComponent(editingId)}/reservations?${new URLSearchParams({
          limit: '25',
          offset: String(recentReservations.length),
        }).toString()}`,
      );
      setRecentReservations((prev) => [...(prev ?? []), ...page.items]);
      setLinkedReservationTotal(page.total);
    } catch {
      /* keep visible list */
    } finally {
      setHistoryLoadingMore(false);
    }
  }

  async function runCustomerMerge() {
    if (!editingId) return;
    setMergeErr(null);
    const p = mergeCustomerBodySchema.safeParse({ intoCustomerId: mergeIntoInput.trim() });
    if (!p.success) {
      setMergeErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
      return;
    }
    if (!window.confirm(t('desk.customers.form.mergeConfirmPrompt'))) {
      return;
    }
    setMergeBusy(true);
    try {
      await apiJson(`/customers/${encodeURIComponent(editingId)}/merge`, {
        method: 'POST',
        body: JSON.stringify(p.data),
      });
      onSaved();
      onClose();
    } catch (er) {
      setMergeErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setMergeBusy(false);
    }
  }

  if (isEdit && loading) {
    return (
      <div className="desk-form-panel" role="region" aria-label={t('desk.customers.form.aria.edit')}>
        <p className="desk-muted">{t('desk.customers.form.loading')}</p>
        {loadErr && <p className="desk-err">{loadErr}</p>}
      </div>
    );
  }

  if (isEdit && loadErr) {
    return (
      <div className="desk-form-panel" role="region">
        <p className="desk-err">{loadErr}</p>
        <button type="button" onClick={onClose}>
          {t('desk.customers.form.close')}
        </button>
      </div>
    );
  }

  if (isEdit && values.anonymizedAt) {
    const tag = locale === 'it' ? 'it-IT' : 'en-GB';
    return (
      <div className="desk-form-panel" role="region" aria-label={t('desk.customers.form.aria.anonymized')}>
        <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('desk.customers.form.anonymizedTitle')}</h3>
        <p className="desk-muted">{t('desk.customers.form.anonymizedBlurb')}</p>
        <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
          {t('desk.customers.form.anonymizedAt')}{' '}
          {new Date(values.anonymizedAt).toLocaleString(tag)}
        </p>
        <div className="desk-form-actions">
          <button type="button" onClick={onClose}>
            {t('desk.customers.form.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="desk-form-panel"
      role="region"
      aria-label={isEdit ? t('desk.customers.form.aria.edit') : t('desk.customers.form.aria.new')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
        {isEdit ? t('desk.customers.form.editTitle') : t('desk.customers.form.newTitle')}
      </h3>
      {isEdit && editingId && companyId && (
        <p className="desk-muted" style={{ margin: '0 0 0.65rem', fontSize: '0.88rem' }}>
          <Link
            href={`/desk/customers?${new URLSearchParams({
              companyId,
              docs: editingId,
            }).toString()}`}
          >
            {t('desk.reservations.customerDocumentsLink')}
          </Link>
          {' · '}
          <Link
            href={`/desk/customers?${new URLSearchParams({
              companyId,
              ocrPending: '1',
              docs: editingId,
            }).toString()}`}
          >
            {t('desk.reservations.customerOcrDocsLink')}
          </Link>
        </p>
      )}
      {isEdit && !loading && recentReservations && recentReservations.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: '#f8fafc', borderRadius: 8 }}>
          <p className="desk-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.88rem' }}>
            {t('desk.customers.form.linkedLead')}
            {me.role === 'AGENT' && me.stationId ? t('desk.customers.form.linkedAgentNote') : ''}
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.9rem', lineHeight: 1.5 }}>
            {recentReservations.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/desk/reservations?${new URLSearchParams({ companyId, open: r.id }).toString()}`}
                  style={{ fontWeight: 600 }}
                >
                  {formatDeskReservationStatus(r.status, t)}
                </Link>
                {' · '}
                <span className="desk-muted">{formatDeskReservationSource(r.source, t).label}</span>
                {' · '}
                {r.vehicle.vehicleClass.name} ({r.vehicle.vehicleClass.code}) — {r.vehicle.licensePlate}
                {' · '}
                {formatTripShort(r.pickupAt, r.returnAt, locale)}
                {r.totalCents != null && r.totalCents > 0 && (
                  <>
                    {' · '}
                    {r.currency} {(r.totalCents / 100).toFixed(2)}
                  </>
                )}
              </li>
            ))}
          </ul>
          {linkedReservationTotal != null &&
            recentReservations &&
            recentReservations.length < linkedReservationTotal && (
              <p style={{ margin: '0.45rem 0 0' }}>
                <button
                  type="button"
                  onClick={() => void loadMoreReservationHistory()}
                  disabled={historyLoadingMore}
                  style={{
                    background: 'var(--color-surface-muted, #f1f5f9)',
                    border: '1px solid var(--color-border, #e2e8f0)',
                    borderRadius: 6,
                    padding: '0.35rem 0.65rem',
                    font: 'inherit',
                    fontSize: '0.88rem',
                    cursor: historyLoadingMore ? 'wait' : 'pointer',
                  }}
                >
                  {historyLoadingMore
                    ? t('desk.customers.form.loadingMoreReservations')
                    : t('desk.customers.form.loadMoreReservations')}
                </button>
              </p>
            )}
          {editingId && (
            <p className="desk-muted" style={{ margin: '0.55rem 0 0', fontSize: '0.88rem' }}>
              <Link
                href={`/desk/reservations?${new URLSearchParams({
                  companyId,
                  customerId: editingId,
                }).toString()}`}
                style={{ fontWeight: 600 }}
              >
                {t('desk.customers.form.openReservationDeskList')}
              </Link>
              {linkedReservationTotal != null &&
                recentReservations &&
                linkedReservationTotal > recentReservations.length && (
                  <>
                    {' '}
                    {t('desk.customers.form.linkedShownOfTotal')
                      .replace('{shown}', String(recentReservations.length))
                      .replace('{total}', String(linkedReservationTotal))}
                  </>
                )}
            </p>
          )}
        </div>
      )}
      {isEdit && !loading && recentReservations && recentReservations.length === 0 && (
        <p className="desk-muted" style={{ marginTop: 0, marginBottom: '0.85rem', fontSize: '0.88rem' }}>
          {t('desk.customers.form.noLinked')}
          {me.role === 'AGENT' && me.stationId ? t('desk.customers.form.noLinkedAgent') : ''}
          {t('desk.customers.form.noLinkedTail')}
          {editingId && (
            <>
              {' '}
              <Link
                href={`/desk/reservations?${new URLSearchParams({
                  companyId,
                  customerId: editingId,
                }).toString()}`}
                style={{ fontWeight: 600 }}
              >
                {t('desk.customers.form.openReservationDeskList')}
              </Link>
            </>
          )}
        </p>
      )}
      <form className="desk-form" onSubmit={onSubmit}>
        <label>
          {t('desk.customers.form.name')}
          <input
            required
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            maxLength={200}
          />
        </label>
        <label>
          {t('desk.customers.form.email')}
          <input
            type="email"
            required
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            maxLength={320}
          />
        </label>
        {emailDupHint && (
          <p className="desk-muted" style={{ margin: '-0.35rem 0 0.75rem', fontSize: '0.88rem' }}>
            {t('desk.customers.form.emailDuplicate')}{' '}
            <Link
              href={`/desk/customers?${new URLSearchParams({ open: emailDupHint.id, companyId }).toString()}`}
              style={{ fontWeight: 600 }}
            >
              {t('desk.customers.form.openExisting').replace('{name}', emailDupHint.name)}
            </Link>
          </p>
        )}
        <label>
          {t('desk.customers.form.phone')}
          <input
            required
            value={values.phone}
            onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
            maxLength={40}
          />
        </label>
        {phoneDupHint && (
          <p className="desk-muted" style={{ margin: '-0.35rem 0 0.75rem', fontSize: '0.88rem' }}>
            {t('desk.customers.form.phoneDuplicate')}{' '}
            <Link
              href={`/desk/customers?${new URLSearchParams({ open: phoneDupHint.id, companyId }).toString()}`}
              style={{ fontWeight: 600 }}
            >
              {t('desk.customers.form.openExisting').replace('{name}', phoneDupHint.name)}
            </Link>
          </p>
        )}
        <fieldset style={{ margin: 0, padding: '0.5rem 0.75rem', borderWidth: 1, borderColor: 'var(--desk-border, #ccc)' }}>
          <legend className="desk-muted" style={{ fontSize: '0.85rem' }}>
            {t('desk.customers.form.fiscalLegend')}
          </legend>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <label>
              {t('desk.customers.form.fiscalCode')}
              <input
                value={values.fiscalCode ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, fiscalCode: e.target.value || null }))}
                maxLength={32}
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={t('desk.customers.form.fiscalCodePh')}
              />
            </label>
            {fiscalDupHint && (
              <p className="desk-muted" style={{ margin: '-0.25rem 0 0', fontSize: '0.88rem' }}>
                {t('desk.customers.form.fiscalDuplicate')}{' '}
                <Link
                  href={`/desk/customers?${new URLSearchParams({ open: fiscalDupHint.id, companyId }).toString()}`}
                  style={{ fontWeight: 600 }}
                >
                  {t('desk.customers.form.openExisting').replace('{name}', fiscalDupHint.name)}
                </Link>
              </p>
            )}
            <label>
              {t('desk.customers.form.vat')}
              <input
                value={values.vatNumber ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, vatNumber: e.target.value || null }))}
                maxLength={20}
                inputMode="numeric"
                placeholder={t('desk.customers.form.vatPh')}
              />
            </label>
            {vatDupHint && (
              <p className="desk-muted" style={{ margin: '-0.25rem 0 0', fontSize: '0.88rem' }}>
                {t('desk.customers.form.vatDuplicate')}{' '}
                <Link
                  href={`/desk/customers?${new URLSearchParams({ open: vatDupHint.id, companyId }).toString()}`}
                  style={{ fontWeight: 600 }}
                >
                  {t('desk.customers.form.openExisting').replace('{name}', vatDupHint.name)}
                </Link>
              </p>
            )}
            <label>
              {t('desk.customers.form.sdi')}
              <input
                value={values.sdiRecipientCode ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, sdiRecipientCode: e.target.value || null }))}
                maxLength={10}
                autoCapitalize="characters"
                placeholder={t('desk.customers.form.sdiPh')}
              />
            </label>
            <label>
              {t('desk.customers.form.pec')}
              <input
                type="email"
                value={values.pec ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, pec: e.target.value || null }))}
                maxLength={320}
                placeholder={t('desk.customers.form.pecPh')}
              />
            </label>
          </div>
        </fieldset>
        <label>
          {t('desk.customers.form.notes')}
          <textarea
            value={values.notes ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            maxLength={2000}
            rows={3}
          />
        </label>
        {isEdit && (
          <fieldset
            style={{ margin: 0, padding: '0.5rem 0.75rem', borderWidth: 1, borderColor: 'var(--desk-border, #ccc)' }}
          >
            <legend className="desk-muted" style={{ fontSize: '0.85rem' }}>
              {t('desk.customers.form.privacyLegend')}
            </legend>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {privacyRegister.length > 0 && (
                <datalist id="desk-customer-privacy-register">
                  {privacyRegister.map((n) => (
                    <option key={n.id} value={n.version} />
                  ))}
                </datalist>
              )}
              <p className="desk-muted" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45 }}>
                {t('desk.customers.form.privacyRegisterHint')}
              </p>
              <label>
                {t('desk.customers.form.privacyVersion')}
                <input
                  value={values.privacyNoticeVersion ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, privacyNoticeVersion: e.target.value || null }))
                  }
                  maxLength={64}
                  placeholder={t('desk.customers.form.privacyVersionPh')}
                  list={privacyRegister.length > 0 ? 'desk-customer-privacy-register' : undefined}
                />
              </label>
              <label>
                {t('desk.customers.form.privacyAccepted')}
                <input
                  type="datetime-local"
                  value={values.privacyAcceptedLocal}
                  onChange={(e) => setValues((v) => ({ ...v, privacyAcceptedLocal: e.target.value }))}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={values.marketingEmailOptIn}
                  onChange={(e) => setValues((v) => ({ ...v, marketingEmailOptIn: e.target.checked }))}
                />
                {t('desk.customers.form.marketingOptIn')}
              </label>
              <p className="desk-muted" style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.45 }}>
                {t('desk.customers.form.privacyAuditHint')}
              </p>
            </div>
          </fieldset>
        )}
        {isEdit && !values.anonymizedAt && canMergeCustomers(me) && editingId && (
          <details
            style={{
              marginTop: '0.85rem',
              padding: '0.5rem 0.75rem',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'rgba(220, 38, 38, 0.35)',
              borderRadius: 8,
              background: 'rgba(254, 242, 242, 0.35)',
            }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' }}>
              {t('desk.customers.form.mergeSummary')}
            </summary>
            <p className="desk-muted" style={{ margin: '0.6rem 0', fontSize: '0.84rem', lineHeight: 1.45 }}>
              {t('desk.customers.form.mergeBlurb')}
            </p>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <span className="desk-muted" style={{ fontSize: '0.82rem' }}>
                {t('desk.customers.form.mergeKeepIdLabel')}
              </span>
              <input
                value={mergeIntoInput}
                onChange={(e) => {
                  setMergeIntoInput(e.target.value);
                  setMergeErr(null);
                }}
                placeholder={t('desk.customers.form.mergeKeepIdPh')}
                maxLength={36}
                spellCheck={false}
                autoCapitalize="off"
                style={{ display: 'block', width: '100%', maxWidth: '28rem', marginTop: '0.25rem' }}
                disabled={mergeBusy}
              />
            </label>
            <button
              type="button"
              onClick={() => void runCustomerMerge()}
              disabled={mergeBusy || !mergeIntoInput.trim()}
              style={{
                background: 'rgba(220, 38, 38, 0.12)',
                border: '1px solid rgba(220, 38, 38, 0.45)',
                borderRadius: 6,
                padding: '0.35rem 0.75rem',
                font: 'inherit',
                fontSize: '0.88rem',
                cursor: mergeBusy ? 'wait' : 'pointer',
              }}
            >
              {mergeBusy ? t('desk.customers.form.mergeBusy') : t('desk.customers.form.mergeRun')}
            </button>
            {mergeErr && (
              <p className="desk-err" style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }} role="alert">
                {mergeErr}
              </p>
            )}
          </details>
        )}
        {submitErr && <p className="desk-err" role="alert">{submitErr}</p>}
        <div className="desk-form-actions">
          <button type="submit" disabled={saving || !canWriteCustomers(me)}>
            {saving
              ? t('desk.customers.form.saving')
              : isEdit
                ? t('desk.customers.form.saveChanges')
                : t('desk.customers.form.create')}
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            {t('desk.customers.form.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
