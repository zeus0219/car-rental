'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { customerDocumentTypeValues, type CustomerDocumentType } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiFetch, apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { formatDeskCustomerDocType } from '../lib/desk-customer-doc-type';
import { fetchPresignedPut } from '../lib/presigned-put';
import type { PublicMessageKey } from '../lib/public-messages';
import { clearAccessToken } from '../lib/auth-storage';
import type { Me } from '../lib/me-types';

type OcrSuggestion = {
  fullName?: string;
  documentNumber?: string;
  expiryDate?: string;
  fiscalCode?: string;
  note?: string;
};

type DocumentOcrStatus = 'NONE' | 'PENDING' | 'READY' | 'FAILED';

type DocumentRow = {
  id: string;
  docType: CustomerDocumentType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByUserId: string | null;
  retentionUntil: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  ocrStatus: DocumentOcrStatus;
  ocrSuggestionJson: unknown;
  ocrCompletedAt: string | null;
  ocrVendor: string | null;
  ocrError: string | null;
  ocrAppliedAt: string | null;
  ocrAppliedByUserId: string | null;
};

type OcrApplyFlags = {
  applyName: boolean;
  applyFiscalCode: boolean;
  appendDetailsToNotes: boolean;
};

const defaultOcrApplyFlags = (): OcrApplyFlags => ({
  applyName: false,
  applyFiscalCode: false,
  appendDetailsToNotes: false,
});

function parseSuggestion(json: unknown): OcrSuggestion | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const out: OcrSuggestion = {};
  if (typeof o.fullName === 'string') out.fullName = o.fullName;
  if (typeof o.documentNumber === 'string') out.documentNumber = o.documentNumber;
  if (typeof o.expiryDate === 'string') out.expiryDate = o.expiryDate;
  if (typeof o.fiscalCode === 'string') out.fiscalCode = o.fiscalCode;
  if (typeof o.note === 'string') out.note = o.note;
  return Object.keys(out).length ? out : null;
}

function formatRetentionDisplay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const OCR_STATUS_LABEL: Record<DocumentOcrStatus, PublicMessageKey> = {
  NONE: 'desk.customers.docs.ocrStatus.none',
  PENDING: 'desk.customers.docs.ocrStatus.pending',
  READY: 'desk.customers.docs.ocrStatus.ready',
  FAILED: 'desk.customers.docs.ocrStatus.failed',
};

type Props = {
  me: Me;
  /** Desk company scope for links (may differ from `me.companyId` for some admins). */
  companyId: string;
  customerId: string;
  canWrite: boolean;
  onClose: () => void;
  /** Optional: refresh parent customer list after OCR apply updates profile fields. */
  onCustomerMutated?: () => void;
};

export function CustomerDocumentsPanel({
  me,
  companyId,
  customerId,
  canWrite,
  onClose,
  onCustomerMutated,
}: Props) {
  void me;
  const { t } = usePublicLocaleContext();
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageMode, setStorageMode] = useState<'local' | 's3' | null>(null);
  const [docType, setDocType] = useState<CustomerDocumentType>('DRIVING_LICENSE');
  const [retentionUntilInput, setRetentionUntilInput] = useState('');
  const [ocrApplyFlags, setOcrApplyFlags] = useState<Record<string, OcrApplyFlags>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const patchApplyFlag = useCallback((id: string, patch: Partial<OcrApplyFlags>) => {
    setOcrApplyFlags((prev) => ({
      ...prev,
      [id]: { ...defaultOcrApplyFlags(), ...prev[id], ...patch },
    }));
  }, []);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const list = await apiJson<DocumentRow[]>(`/customers/${encodeURIComponent(customerId)}/documents`);
      setRows(list);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }, [customerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let c = false;
    void (async () => {
      try {
        const cfg = await apiJson<{ mode: 'local' | 's3' }>('/customers/documents/storage-config');
        if (!c) setStorageMode(cfg.mode);
      } catch {
        if (!c) setStorageMode('local');
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  async function onFileSelected() {
    const el = fileRef.current;
    if (!el?.files?.length) return;
    const f = el.files[0]!;
    setBusy(true);
    setLoadErr(null);
    try {
      let mode = storageMode;
      if (mode === null) {
        const cfg = await apiJson<{ mode: 'local' | 's3' }>('/customers/documents/storage-config');
        mode = cfg.mode;
        setStorageMode(cfg.mode);
      }
      if (mode === 's3') {
        const presignBody: Record<string, unknown> = {
          originalName: f.name,
          mimeType: f.type || 'application/pdf',
          sizeBytes: f.size,
          docType,
        };
        if (retentionUntilInput.trim()) {
          presignBody.retentionUntil = new Date(retentionUntilInput).toISOString();
        }
        const presign = await apiJson<{
          document: DocumentRow;
          uploadUrl: string;
          method: 'PUT';
          headers: Record<string, string>;
        }>(`/customers/${encodeURIComponent(customerId)}/documents/presign`, {
          method: 'POST',
          body: JSON.stringify(presignBody),
        });
        const put = await fetchPresignedPut(presign.uploadUrl, f, presign.headers, t);
        if (!put.ok) {
          try {
            await apiFetch(
              `/customers/${encodeURIComponent(customerId)}/documents/${presign.document.id}`,
              { method: 'DELETE' },
            );
          } catch {
            // best-effort
          }
          throw new Error(t('desk.storage.presignPutRejected').replace('{status}', String(put.status)));
        }
        const row = await apiJson<DocumentRow>(
          `/customers/${encodeURIComponent(customerId)}/documents/${presign.document.id}/complete`,
          { method: 'POST' },
        );
        setRows((prev) => [...prev, row]);
        return;
      }
      const fd = new FormData();
      fd.append('file', f);
      fd.append('docType', docType);
      if (retentionUntilInput.trim()) {
        fd.append('retentionUntil', new Date(retentionUntilInput).toISOString());
      }
      const r = await apiFetch(`/customers/${encodeURIComponent(customerId)}/documents`, {
        method: 'POST',
        body: fd,
      });
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') window.location.assign('/auth');
        return;
      }
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(translateDeskApiError(errBody || r.statusText));
      }
      const row = (await r.json()) as DocumentRow;
      setRows((prev) => [...prev, row]);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
      if (el) el.value = '';
    }
  }

  async function onSetVerified(d: DocumentRow, verified: boolean) {
    if (!canWrite) return;
    setBusy(true);
    setLoadErr(null);
    try {
      const row = await apiJson<DocumentRow>(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}/verification`,
        { method: 'PATCH', body: JSON.stringify({ verified }) },
      );
      setRows((prev) => prev.map((x) => (x.id === d.id ? row : x)));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onRunMockOcr(d: DocumentRow) {
    if (!canWrite) return;
    setBusy(true);
    setLoadErr(null);
    try {
      const row = await apiJson<DocumentRow>(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}/ocr/mock`,
        { method: 'POST' },
      );
      setRows((prev) => prev.map((x) => (x.id === d.id ? row : x)));
      patchApplyFlag(d.id, defaultOcrApplyFlags());
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onDismissOcr(d: DocumentRow) {
    if (!canWrite) return;
    setBusy(true);
    setLoadErr(null);
    try {
      const row = await apiJson<DocumentRow>(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}/ocr/suggestion`,
        { method: 'DELETE' },
      );
      setRows((prev) => prev.map((x) => (x.id === d.id ? row : x)));
      setOcrApplyFlags((prev) => {
        const next = { ...prev };
        delete next[d.id];
        return next;
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onApplyOcr(d: DocumentRow) {
    if (!canWrite) return;
    const flags = { ...defaultOcrApplyFlags(), ...ocrApplyFlags[d.id] };
    setBusy(true);
    setLoadErr(null);
    try {
      const row = await apiJson<DocumentRow>(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}/ocr/apply`,
        {
          method: 'POST',
          body: JSON.stringify({
            applyName: flags.applyName,
            applyFiscalCode: flags.applyFiscalCode,
            appendDetailsToNotes: flags.appendDetailsToNotes,
          }),
        },
      );
      setRows((prev) => prev.map((x) => (x.id === d.id ? row : x)));
      onCustomerMutated?.();
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(d: DocumentRow) {
    setLoadErr(null);
    try {
      const r = await apiFetch(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}/file`,
      );
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') window.location.assign('/auth');
        return;
      }
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(translateDeskApiError(errBody || r.statusText));
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.originalName;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function onDelete(d: DocumentRow) {
    if (!canWrite) return;
    if (!window.confirm(t('desk.customers.docs.confirmDelete').replace('{name}', d.originalName))) return;
    setBusy(true);
    setLoadErr(null);
    try {
      await apiJson(
        `/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(d.id)}`,
        { method: 'DELETE' },
      );
      setRows((prev) => prev.filter((x) => x.id !== d.id));
      setOcrApplyFlags((prev) => {
        const next = { ...prev };
        delete next[d.id];
        return next;
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="desk-form-panel"
      style={{ marginTop: '1rem' }}
      aria-label={t('desk.customers.docs.aria')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0 }}>{t('desk.customers.docs.title')}</h2>
        <button type="button" onClick={onClose} className="desk-muted">
          {t('desk.customers.docs.close')}
        </button>
      </div>
      <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
        {t('desk.customers.docs.intro')}
      </p>
      <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: '0.35rem' }}>
        {t('desk.customers.docs.ocrIntro')}
      </p>
      <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: '0.35rem' }}>
        <Link
          href={`/desk/customers?${new URLSearchParams({
            companyId,
            ocrPending: '1',
            docs: customerId,
          }).toString()}`}
        >
          {t('desk.reservations.customerOcrDocsLink')}
        </Link>
        {' · '}
        <Link
          href={`/desk/customers?${new URLSearchParams({
            companyId,
            ocrPending: '1',
          }).toString()}`}
        >
          {t('desk.customers.docs.linkOcrCompanyWide')}
        </Link>
      </p>
      {canWrite && (
        <div className="desk-tool" style={{ marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            {t('desk.customers.docs.typeLabel')}
            <select value={docType} onChange={(e) => setDocType(e.target.value as CustomerDocumentType)}>
              {customerDocumentTypeValues.map((v) => (
                <option key={v} value={v}>
                  {formatDeskCustomerDocType(v, t)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} className="desk-muted">
            {t('desk.customers.docs.retentionOptional')}
            <input
              type="datetime-local"
              value={retentionUntilInput}
              onChange={(e) => setRetentionUntilInput(e.target.value)}
              disabled={busy}
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            style={{ maxWidth: '12rem' }}
            onChange={() => void onFileSelected()}
            disabled={busy}
          />
          {busy && <span className="desk-muted">{t('desk.customers.docs.working')}</span>}
        </div>
      )}
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {rows.length === 0 && !loadErr && <p className="desk-muted">{t('desk.customers.docs.empty')}</p>}
      {rows.length > 0 && (
        <div className="desk-table-wrap" style={{ marginTop: '0.5rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.customers.docs.th.type')}</th>
                <th>{t('desk.customers.docs.th.file')}</th>
                <th>{t('desk.customers.docs.th.size')}</th>
                <th>{t('desk.customers.docs.th.retention')}</th>
                <th>{t('desk.customers.docs.th.verified')}</th>
                <th>{t('desk.customers.docs.th.ocr')}</th>
                <th>{t('desk.customers.docs.th.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const sug = parseSuggestion(d.ocrSuggestionJson);
                const flags = { ...defaultOcrApplyFlags(), ...ocrApplyFlags[d.id] };
                const showOcrPanel =
                  (d.ocrStatus === 'READY' && sug && !d.ocrAppliedAt) ||
                  (d.ocrStatus === 'PENDING' && !d.ocrAppliedAt) ||
                  Boolean(d.ocrAppliedAt) ||
                  d.ocrStatus === 'FAILED';
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td>{formatDeskCustomerDocType(d.docType, t)}</td>
                      <td>
                        <code style={{ fontSize: '0.85rem' }}>{d.originalName}</code>
                      </td>
                      <td>{d.sizeBytes != null ? `${(d.sizeBytes / 1024).toFixed(0)} KB` : '—'}</td>
                      <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                        {formatRetentionDisplay(d.retentionUntil)}
                      </td>
                      <td style={{ fontSize: '0.9rem' }}>
                        {d.verifiedAt ? t('desk.customers.docs.verifiedYes') : t('desk.customers.docs.verifiedNo')}
                      </td>
                      <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                        {d.ocrAppliedAt
                          ? t('desk.customers.docs.ocrApplied')
                          : t(OCR_STATUS_LABEL[d.ocrStatus])}
                        {d.ocrVendor ? ` · ${d.ocrVendor}` : ''}
                      </td>
                      <td>
                        <div className="desk-table-actions">
                          <button type="button" onClick={() => void onDownload(d)}>
                            {t('desk.customers.docs.download')}
                          </button>
                          {canWrite && (
                            <>
                              {!d.ocrAppliedAt && (
                                <button
                                  type="button"
                                  onClick={() => void onRunMockOcr(d)}
                                  disabled={busy}
                                >
                                  {t('desk.customers.docs.ocrRunMock')}
                                </button>
                              )}
                              {d.verifiedAt ? (
                                <button
                                  type="button"
                                  onClick={() => void onSetVerified(d, false)}
                                  disabled={busy}
                                >
                                  {t('desk.customers.docs.clearVerify')}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void onSetVerified(d, true)}
                                  disabled={busy}
                                >
                                  {t('desk.customers.docs.verify')}
                                </button>
                              )}
                              <button type="button" onClick={() => void onDelete(d)} disabled={busy}>
                                {t('desk.customers.docs.delete')}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {showOcrPanel && (
                      <tr className="desk-muted">
                        <td colSpan={7} style={{ fontSize: '0.88rem', lineHeight: 1.45 }}>
                          {d.ocrStatus === 'PENDING' && !d.ocrAppliedAt && (
                            <p style={{ margin: '0.25rem 0' }}>{t('desk.customers.docs.ocrPendingWorker')}</p>
                          )}
                          {d.ocrStatus === 'FAILED' && d.ocrError && (
                            <p style={{ margin: '0.25rem 0', color: 'var(--desk-err, #c00)' }}>{d.ocrError}</p>
                          )}
                          {d.ocrStatus === 'READY' && sug && !d.ocrAppliedAt && (
                            <>
                              <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                                {t('desk.customers.docs.ocrSuggestionTitle')}
                              </div>
                              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
                                {sug.fullName && (
                                  <li>
                                    <strong>Name:</strong> {sug.fullName}
                                  </li>
                                )}
                                {sug.fiscalCode && (
                                  <li>
                                    <strong>CF:</strong> {sug.fiscalCode}
                                  </li>
                                )}
                                {sug.documentNumber && (
                                  <li>
                                    <strong>Doc #:</strong> {sug.documentNumber}
                                  </li>
                                )}
                                {sug.expiryDate && (
                                  <li>
                                    <strong>Exp:</strong> {sug.expiryDate}
                                  </li>
                                )}
                                {sug.note && (
                                  <li>
                                    <em>{sug.note}</em>
                                  </li>
                                )}
                              </ul>
                              <div className="desk-tool" style={{ flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={flags.applyName}
                                    disabled={!sug.fullName || busy}
                                    onChange={(e) => patchApplyFlag(d.id, { applyName: e.target.checked })}
                                  />
                                  {t('desk.customers.docs.ocrApplyName')}
                                </label>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={flags.applyFiscalCode}
                                    disabled={!sug.fiscalCode || busy}
                                    onChange={(e) =>
                                      patchApplyFlag(d.id, { applyFiscalCode: e.target.checked })
                                    }
                                  />
                                  {t('desk.customers.docs.ocrApplyFiscal')}
                                </label>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={flags.appendDetailsToNotes}
                                    disabled={
                                      busy || (!sug.documentNumber && !sug.expiryDate)
                                    }
                                    onChange={(e) =>
                                      patchApplyFlag(d.id, {
                                        appendDetailsToNotes: e.target.checked,
                                      })
                                    }
                                  />
                                  {t('desk.customers.docs.ocrAppendNotes')}
                                </label>
                                <button type="button" disabled={busy} onClick={() => void onApplyOcr(d)}>
                                  {t('desk.customers.docs.ocrApply')}
                                </button>
                                <button type="button" disabled={busy} onClick={() => void onDismissOcr(d)}>
                                  {t('desk.customers.docs.ocrDismiss')}
                                </button>
                              </div>
                            </>
                          )}
                          {d.ocrAppliedAt && (
                            <p style={{ margin: '0.25rem 0' }}>
                              {t('desk.customers.docs.ocrApplied')} — {formatRetentionDisplay(d.ocrAppliedAt)}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
