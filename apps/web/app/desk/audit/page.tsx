'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { formatDeskAuditEntityLabel, isDeskAuditEntityKnown } from '../../../lib/desk-audit-entity-label';
import type { PublicLocale } from '../../../lib/public-locale';
import { publicAuditActionLabel, publicMessages, publicT, type PublicMessageKey } from '../../../lib/public-messages';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type AuditRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
};

const RESERVATION_UUID_RE = /^[0-9a-f-]{36}$/i;

function linkedReservationIdFromAuditMetadata(r: AuditRow): string | null {
  if (r.entity === 'Reservation') {
    return null;
  }
  if (!r.metadata || typeof r.metadata !== 'object') {
    return null;
  }
  const rid = (r.metadata as Record<string, unknown>).reservationId;
  return typeof rid === 'string' && RESERVATION_UUID_RE.test(rid) ? rid : null;
}

function linkedInvoiceIdFromAuditMetadata(r: AuditRow): string | null {
  if (r.entity === 'Invoice') {
    return null;
  }
  if (!r.metadata || typeof r.metadata !== 'object') {
    return null;
  }
  const iid = (r.metadata as Record<string, unknown>).invoiceId;
  return typeof iid === 'string' && RESERVATION_UUID_RE.test(iid) ? iid : null;
}

function linkedCustomerIdFromAuditMetadata(r: AuditRow): string | null {
  if (r.entity === 'Customer') {
    return null;
  }
  if (!r.metadata || typeof r.metadata !== 'object') {
    return null;
  }
  const cid = (r.metadata as Record<string, unknown>).customerId;
  return typeof cid === 'string' && RESERVATION_UUID_RE.test(cid) ? cid : null;
}

function fmtTime(iso: string, locale: PublicLocale) {
  try {
    const tag = locale === 'it' ? 'it-IT' : 'en-GB';
    return new Date(iso).toLocaleString(tag, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function canViewAudit(role: string): boolean {
  return role === 'ADMIN' || role === 'BRANCH_MANAGER' || role === 'READONLY_ACCOUNTING';
}

function depositCaptureSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'reservation.deposit.capture') return null;
  const m = r.metadata;
  if (!m || typeof m !== 'object') return null;
  const rec = m as Record<string, unknown>;
  const cents = rec.captureAmountCents;
  if (typeof cents !== 'number') return null;
  const partial = rec.partial === true;
  const fmt = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  });
  const amountStr = fmt.format(cents / 100);
  const template = publicT(
    locale,
    partial ? 'desk.audit.depositCaptureLinePartial' : 'desk.audit.depositCaptureLineFull',
  );
  let line = template.replace('{amount}', amountStr);
  const drId = rec.damageReportId;
  if (typeof drId === 'string' && drId.length > 0) {
    line = `${line} — ${publicT(locale, 'desk.audit.depositLinkedDamageReport').replace('{id}', drId)}`;
  }
  const sugg = rec.damageSuggestedCaptureCents;
  if (typeof sugg === 'number' && sugg >= 1) {
    const suggStr = fmt.format(sugg / 100);
    line = `${line} — ${publicT(locale, 'desk.audit.depositDamageSuggestedCapture').replace('{amount}', suggStr)}`;
  }
  return line;
}

function stripeRefundSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'reservation.stripe.refund') return null;
  const m = r.metadata;
  if (!m || typeof m !== 'object') return null;
  const rec = m as Record<string, unknown>;
  const cents = rec.amountCents;
  if (typeof cents !== 'number') return null;
  const curRaw = rec.currency;
  const cur =
    typeof curRaw === 'string' && /^[a-zA-Z]{3}$/.test(curRaw) ? curRaw.toUpperCase() : 'EUR';
  const partial = rec.partial === true;
  const target = rec.target === 'DEPOSIT' ? 'DEPOSIT' : 'RENTAL';
  const fmt = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    style: 'currency',
    currency: cur,
  });
  const amountStr = fmt.format(cents / 100);
  const label = publicT(
    locale,
    target === 'DEPOSIT' ? 'desk.audit.refundTarget.deposit' : 'desk.audit.refundTarget.rental',
  );
  const template = publicT(
    locale,
    partial ? 'desk.audit.refundLinePartial' : 'desk.audit.refundLineFull',
  );
  return `${template.replace('{amount}', amountStr)} · ${label}`;
}

function fmtB4AuditIso(locale: PublicLocale, iso: string | null | undefined): string {
  if (iso == null || iso === '') {
    return publicT(locale, 'desk.fleet.quote.emDash');
  }
  return fmtTime(iso, locale);
}

function fmtB4AuditBool(locale: PublicLocale, v: unknown): string {
  return v === true
    ? publicT(locale, 'desk.res.form.yes')
    : publicT(locale, 'desk.res.form.no');
}

function b4ConsentAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'customer.b4_consent_update' && r.action !== 'customer.b4_public_quote') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const rec = m as Record<string, unknown>;
  const before = rec.before;
  const after = rec.after;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return null;
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const dash = publicT(locale, 'desk.fleet.quote.emDash');
  const parts: string[] = [];
  if (b.privacyNoticeVersion !== a.privacyNoticeVersion) {
    parts.push(
      publicT(locale, 'desk.audit.b4Consent.privacyVersion')
        .replace('{from}', String(b.privacyNoticeVersion ?? dash))
        .replace('{to}', String(a.privacyNoticeVersion ?? dash)),
    );
  }
  if (b.privacyNoticeAcceptedAt !== a.privacyNoticeAcceptedAt) {
    parts.push(
      publicT(locale, 'desk.audit.b4Consent.privacyAccepted')
        .replace('{from}', fmtB4AuditIso(locale, b.privacyNoticeAcceptedAt as string))
        .replace('{to}', fmtB4AuditIso(locale, a.privacyNoticeAcceptedAt as string)),
    );
  }
  if (b.marketingEmailOptIn !== a.marketingEmailOptIn) {
    parts.push(
      publicT(locale, 'desk.audit.b4Consent.marketing')
        .replace('{from}', fmtB4AuditBool(locale, b.marketingEmailOptIn))
        .replace('{to}', fmtB4AuditBool(locale, a.marketingEmailOptIn)),
    );
  }
  if (b.marketingOptInAt !== a.marketingOptInAt) {
    parts.push(
      publicT(locale, 'desk.audit.b4Consent.marketingAt')
        .replace('{from}', fmtB4AuditIso(locale, b.marketingOptInAt as string))
        .replace('{to}', fmtB4AuditIso(locale, a.marketingOptInAt as string)),
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function customerMergeAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'customer.merge') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const rec = m as Record<string, unknown>;
  const from = rec.fromCustomerId;
  const into = rec.intoCustomerId;
  if (typeof from !== 'string' || typeof into !== 'string') {
    return null;
  }
  if (!RESERVATION_UUID_RE.test(from) || !RESERVATION_UUID_RE.test(into)) {
    return null;
  }
  const resN = typeof rec.reservationsMoved === 'number' ? rec.reservationsMoved : 0;
  const docN = typeof rec.documentsMoved === 'number' ? rec.documentsMoved : 0;
  return publicT(locale, 'desk.audit.customerMerge.summary')
    .replace('{from}', from)
    .replace('{into}', into)
    .replace('{res}', String(resN))
    .replace('{docs}', String(docN));
}

function partnerOauthAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'partner_api_key.oauth_client') {
    return null;
  }
  return publicT(locale, 'desk.audit.partnerOauth.regenerated');
}

function ocrAsyncCallbackAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'customer_document.ocr_async_callback') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const out = (m as Record<string, unknown>).outcome;
  if (out === 'FAILED') {
    return publicT(locale, 'desk.audit.ocrAsync.outcomeFailed');
  }
  if (out === 'READY') {
    return publicT(locale, 'desk.audit.ocrAsync.outcomeReady');
  }
  return null;
}

function partnerApiAllowedIpAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'partner_api_key.allowed_ip') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const rec = m as Record<string, unknown>;
  const parts: string[] = [];
  if (rec.cleared === true) {
    parts.push(publicT(locale, 'desk.audit.partnerAllowedIp.cleared'));
  }
  if (rec.configured === true) {
    parts.push(publicT(locale, 'desk.audit.partnerAllowedIp.configured'));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function partnerApiWebhookAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'partner_api_key.webhook') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const rec = m as Record<string, unknown>;
  const parts: string[] = [];
  if (rec.clearedUrl === true) {
    parts.push(publicT(locale, 'desk.audit.partnerWebhook.clearedUrl'));
  }
  if (rec.clearedSecret === true) {
    parts.push(publicT(locale, 'desk.audit.partnerWebhook.clearedSecret'));
  }
  if (rec.setUrl === true) {
    parts.push(publicT(locale, 'desk.audit.partnerWebhook.setUrl'));
  }
  if (rec.setSecret === true) {
    parts.push(publicT(locale, 'desk.audit.partnerWebhook.setSecret'));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function deskReservationStatusLabelForAudit(locale: PublicLocale, status: string): string {
  const k = `desk.reservations.status.${status}`;
  const loc = publicMessages[locale] as Record<string, string>;
  const en = publicMessages.en as Record<string, string>;
  return loc[k] ?? en[k] ?? status;
}

function partnerReservationCancelAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (r.action !== 'reservation.partner_cancel') {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') {
    return null;
  }
  const ps = (m as Record<string, unknown>).previousStatus;
  if (typeof ps !== 'string' || ps.length === 0) {
    return null;
  }
  const statusLabel = deskReservationStatusLabelForAudit(locale, ps);
  return publicT(locale, 'desk.audit.partnerReservationCancel.fromStatus').replace('{status}', statusLabel);
}

const DAMAGE_REPORT_STATUS_I18N: Record<string, PublicMessageKey> = {
  DRAFT: 'desk.audit.damageReport.status.DRAFT',
  CLOSED: 'desk.audit.damageReport.status.CLOSED',
};

function damageReportStatusLabel(locale: PublicLocale, raw: string): string {
  const k = DAMAGE_REPORT_STATUS_I18N[raw];
  return k ? publicT(locale, k) : raw;
}

function damageReportAuditSummary(locale: PublicLocale, r: AuditRow): string | null {
  if (
    r.action !== 'reservation.damage_report.create' &&
    r.action !== 'reservation.damage_report.update'
  ) {
    return null;
  }
  const m = r.metadata;
  if (!m || typeof m !== 'object') return null;
  const rec = m as Record<string, unknown>;
  const parts: string[] = [];
  const lc = rec.lineCount;
  if (typeof lc === 'number' && lc >= 0) {
    parts.push(publicT(locale, 'desk.audit.damageReportLineCount').replace('{count}', String(lc)));
  }
  const st = rec.status;
  if (typeof st === 'string' && st.length > 0) {
    parts.push(
      publicT(locale, 'desk.audit.damageReportStatus').replace(
        '{status}',
        damageReportStatusLabel(locale, st),
      ),
    );
  }
  const sugg = rec.suggestedCaptureCents;
  if (typeof sugg === 'number' && sugg >= 1) {
    const fmt = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
      style: 'currency',
      currency: 'EUR',
    });
    parts.push(
      publicT(locale, 'desk.audit.damageReportSuggestedCapture').replace(
        '{amount}',
        fmt.format(sugg / 100),
      ),
    );
  }
  if (!parts.length) return null;
  return parts.join(' · ');
}

function AuditPageContent() {
  const { t, locale } = usePublicLocaleContext();
  const searchParams = useSearchParams();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionInput, setActionInput] = useState('');
  const [actionApplied, setActionApplied] = useState('');

  const allowed = me ? canViewAudit(me.role) : false;

  useEffect(() => {
    const a = searchParams.get('action') ?? '';
    setActionInput(a);
    setActionApplied(a);
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!companyId || !allowed) {
      return;
    }
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('companyId', companyId);
      q.set('take', '150');
      const actionTrim = actionApplied.trim();
      if (actionTrim) {
        q.set('action', actionTrim);
      }
      const list = await apiJson<AuditRow[]>(`/audit-logs?${q.toString()}`);
      setRows(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, allowed, actionApplied, t]);

  useEffect(() => {
    if (!ready || !companyId || !allowed) {
      return;
    }
    void load();
  }, [ready, companyId, allowed, load]);

  if (meLoading) {
    return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  }
  if (meErr) {
    return <p className="desk-err">{meErr}</p>;
  }
  if (!me) {
    return null;
  }
  if (!canViewAudit(me.role)) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>{t('desk.audit.title')}</h1>
        <p className="desk-muted">{t('desk.audit.denied')}</p>
      </div>
    );
  }
  if (scopeErr) {
    return <p className="desk-err">{scopeErr}</p>;
  }
  if (!ready) {
    return <p className="desk-muted">{t('desk.loadingCompanies')}</p>;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.audit.title')}</h1>
      <p className="desk-muted" style={{ marginTop: 0 }}>
        {t('desk.audit.intro')}
      </p>
      <CompanyScopeSelect me={me} companies={companies} companyId={companyId} onChange={setCompanyId} />
      {companyId && (
        <div className="desk-tool" style={{ marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>{t('desk.audit.filterLabel')}</span>
            <input
              type="search"
              value={actionInput}
              onChange={(e) => {
                setActionInput(e.target.value);
              }}
              placeholder={t('desk.audit.placeholder')}
              style={{ minWidth: '14rem' }}
            />
            <button
              type="button"
              onClick={() => {
                setActionApplied(actionInput.trim());
              }}
            >
              {t('desk.audit.apply')}
            </button>
            <button
              type="button"
              onClick={() => {
                setActionInput('');
                setActionApplied('');
              }}
            >
              {t('desk.audit.clear')}
            </button>
          </label>
        </div>
      )}
      {err && <p className="desk-err">{err}</p>}
      {loading && <p className="desk-muted">{t('booking.loading')}</p>}
      {!loading && !err && companyId && (
        <div className="desk-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.audit.col.when')}</th>
                <th>{t('desk.audit.col.user')}</th>
                <th>{t('desk.audit.col.action')}</th>
                <th>{t('desk.audit.col.entity')}</th>
                <th>{t('desk.audit.col.entityId')}</th>
                <th>{t('desk.audit.col.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const detailLine =
                  depositCaptureSummary(locale, r) ??
                  stripeRefundSummary(locale, r) ??
                  b4ConsentAuditSummary(locale, r) ??
                  customerMergeAuditSummary(locale, r) ??
                  damageReportAuditSummary(locale, r) ??
                  ocrAsyncCallbackAuditSummary(locale, r) ??
                  partnerOauthAuditSummary(locale, r) ??
                  partnerApiAllowedIpAuditSummary(locale, r) ??
                  partnerApiWebhookAuditSummary(locale, r) ??
                  partnerReservationCancelAuditSummary(locale, r);
                return (
                  <tr key={r.id}>
                    <td>{fmtTime(r.createdAt, locale)}</td>
                    <td>
                      {r.user ? (
                        <>
                          {r.user.firstName} {r.user.lastName}
                          <span className="desk-muted" style={{ display: 'block', fontSize: '0.85rem' }}>
                            {r.user.email}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td title={r.action}>
                      <span>{publicAuditActionLabel(locale, r.action)}</span>
                      {detailLine ? (
                        <span className="desk-muted" style={{ display: 'block', fontSize: '0.85rem' }}>
                          {detailLine}
                        </span>
                      ) : null}
                    </td>
                    <td title={r.entity}>
                      {isDeskAuditEntityKnown(r.entity) ? (
                        formatDeskAuditEntityLabel(r.entity, t)
                      ) : (
                        <code>{r.entity}</code>
                      )}
                    </td>
                    <td>
                      {r.entityId ? (
                        r.entity === 'Reservation' &&
                        RESERVATION_UUID_RE.test(r.entityId) &&
                        companyId ? (
                          <Link
                            href={`/desk/reservations?open=${encodeURIComponent(r.entityId)}&companyId=${encodeURIComponent(companyId)}`}
                            title={t('desk.audit.openReservation')}
                          >
                            <code>{r.entityId}</code>
                          </Link>
                        ) : r.entity === 'Invoice' &&
                          RESERVATION_UUID_RE.test(r.entityId) &&
                          companyId ? (
                          <Link
                            href={`/desk/invoices?open=${encodeURIComponent(r.entityId)}&companyId=${encodeURIComponent(companyId)}`}
                            title={t('desk.audit.openInvoice')}
                          >
                            <code>{r.entityId}</code>
                          </Link>
                        ) : r.entity === 'Customer' &&
                          RESERVATION_UUID_RE.test(r.entityId) &&
                          companyId ? (
                          <Link
                            href={`/desk/customers?open=${encodeURIComponent(r.entityId)}&companyId=${encodeURIComponent(companyId)}`}
                            title={t('desk.audit.openCustomer')}
                          >
                            <code>{r.entityId}</code>
                          </Link>
                        ) : (
                          <code>{r.entityId}</code>
                        )
                      ) : (
                        '—'
                      )}
                      {(() => {
                        const lid = linkedReservationIdFromAuditMetadata(r);
                        return lid && companyId ? (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                            <Link
                              href={`/desk/reservations?open=${encodeURIComponent(lid)}&companyId=${encodeURIComponent(companyId)}`}
                              title={t('desk.audit.openReservation')}
                            >
                              {t('desk.audit.openLinkedReservation')}
                            </Link>
                          </div>
                        ) : null;
                      })()}
                      {(() => {
                        const iid = linkedInvoiceIdFromAuditMetadata(r);
                        return iid && companyId ? (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                            <Link
                              href={`/desk/invoices?open=${encodeURIComponent(iid)}&companyId=${encodeURIComponent(companyId)}`}
                              title={t('desk.audit.openInvoice')}
                            >
                              {t('desk.audit.openLinkedInvoice')}
                            </Link>
                          </div>
                        ) : null;
                      })()}
                      {(() => {
                        const cid = linkedCustomerIdFromAuditMetadata(r);
                        return cid && companyId ? (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
                            <Link
                              href={`/desk/customers?open=${encodeURIComponent(cid)}&companyId=${encodeURIComponent(companyId)}`}
                              title={t('desk.audit.openCustomer')}
                            >
                              {t('desk.audit.openLinkedCustomer')}
                            </Link>
                          </div>
                        ) : null;
                      })()}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{r.ip ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="desk-muted">{t('desk.audit.empty')}</p>}
        </div>
      )}
    </div>
  );
}

function AuditSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return <p className="desk-muted">{t('booking.loading')}</p>;
}

export default function AuditPage() {
  return (
    <Suspense fallback={<AuditSuspenseFallback />}>
      <AuditPageContent />
    </Suspense>
  );
}
