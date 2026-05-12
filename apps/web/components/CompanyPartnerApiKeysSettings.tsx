'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPartnerApiKeySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiFetch, apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { PublicLocale } from '../lib/public-locale';
import type { Me } from '../lib/me-types';

function makeFmtDeskDateTime(locale: PublicLocale) {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  return (iso: string) => {
    try {
      return new Date(iso).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };
}

type PartnerKeyRow = {
  id: string;
  name: string;
  maskedKey: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  allowedIpCidrs: string | null;
  oauthClientConfigured: boolean;
};

function truncateUrl(u: string | null, max = 36): string {
  if (!u) return '';
  if (u.length <= max) return u;
  return `${u.slice(0, max - 1)}…`;
}

function canViewPartnerKeys(me: Me, companyId: string): boolean {
  if (me.role === 'READONLY_ACCOUNTING' && me.companyId === companyId) {
    return true;
  }
  return canEditCompanySettings(me, companyId);
}

function canEditCompanySettings(me: Me, companyId: string): boolean {
  if (me.role === 'ADMIN') {
    return true;
  }
  if (me.role === 'BRANCH_MANAGER' && me.companyId === companyId) {
    return true;
  }
  return false;
}

type Props = {
  me: Me;
  companyId: string;
};

export function CompanyPartnerApiKeysSettings({ me, companyId }: Props) {
  const { t, locale } = usePublicLocaleContext();
  const fmtDt = useMemo(() => makeFmtDeskDateTime(locale), [locale]);
  const [rows, setRows] = useState<PartnerKeyRow[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [webhookEditId, setWebhookEditId] = useState<string | null>(null);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [allowlistCidrsInput, setAllowlistCidrsInput] = useState('');
  const [allowlistSaving, setAllowlistSaving] = useState(false);
  const [oauthSaving, setOauthSaving] = useState(false);
  const [oauthSecretOnce, setOauthSecretOnce] = useState<{ clientId: string; clientSecret: string } | null>(
    null,
  );
  const [oauthCopied, setOauthCopied] = useState(false);

  const canEdit = canEditCompanySettings(me, companyId);
  const canView = canViewPartnerKeys(me, companyId);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const list = await apiJson<PartnerKeyRow[]>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys`,
      );
      setRows(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, t, canView]);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [load, canView]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    setPlaintextKey(null);
    setCopied(false);
    setOauthSecretOnce(null);
    setOauthCopied(false);
    const parsed = createPartnerApiKeySchema.safeParse({ name: nameInput });
    if (!parsed.success) {
      setSubmitErr(t('desk.err.generic'));
      return;
    }
    setSaving(true);
    try {
      const created = await apiJson<{ id: string; name: string; apiKey: string; createdAt: string }>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys`,
        {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        },
      );
      setPlaintextKey(created.apiKey);
      setNameInput('');
      await load();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function regenerateOauthSecret(keyId: string) {
    setSubmitErr(null);
    setOauthCopied(false);
    setOauthSaving(true);
    try {
      const res = await apiJson<{ clientId: string; clientSecret: string }>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys/${encodeURIComponent(keyId)}/oauth-client-secret`,
        { method: 'POST' },
      );
      setOauthSecretOnce(res);
      await load();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setOauthSaving(false);
    }
  }

  async function saveAllowlist(keyId: string) {
    setSubmitErr(null);
    setAllowlistSaving(true);
    try {
      const res = await apiJson<{ id: string; allowedIpCidrs: string | null }>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys/${encodeURIComponent(keyId)}/allowed-ip-cidrs`,
        {
          method: 'PATCH',
          body: JSON.stringify({ allowedIpCidrs: allowlistCidrsInput }),
        },
      );
      setRows((prev) =>
        prev.map((row) =>
          row.id === res.id ? { ...row, allowedIpCidrs: res.allowedIpCidrs } : row,
        ),
      );
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAllowlistSaving(false);
    }
  }

  async function saveWebhook(keyId: string) {
    setSubmitErr(null);
    setWebhookSaving(true);
    try {
      const body: { webhookUrl: string; webhookSigningSecret?: string } = {
        webhookUrl: webhookUrlInput.trim() === '' ? '' : webhookUrlInput.trim(),
      };
      const sec = webhookSecretInput.trim();
      if (sec.length >= 8) {
        body.webhookSigningSecret = sec;
      }
      const res = await apiJson<{
        id: string;
        webhookUrl: string | null;
        webhookSecretConfigured: boolean;
      }>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys/${encodeURIComponent(keyId)}/webhook`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      setRows((prev) =>
        prev.map((row) =>
          row.id === res.id
            ? {
                ...row,
                webhookUrl: res.webhookUrl,
                webhookSecretConfigured: res.webhookSecretConfigured,
              }
            : row,
        ),
      );
      setWebhookEditId(null);
      setWebhookUrlInput('');
      setWebhookSecretInput('');
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setWebhookSaving(false);
    }
  }

  async function clearWebhookSecretOnly(keyId: string) {
    if (!window.confirm(t('desk.organization.partnerApiWebhook.clearSecretConfirm'))) {
      return;
    }
    setSubmitErr(null);
    setWebhookSaving(true);
    try {
      const res = await apiJson<{
        id: string;
        webhookUrl: string | null;
        webhookSecretConfigured: boolean;
      }>(
        `/companies/${encodeURIComponent(companyId)}/partner-api-keys/${encodeURIComponent(keyId)}/webhook`,
        {
          method: 'PATCH',
          body: JSON.stringify({ webhookSigningSecret: '' }),
        },
      );
      setRows((prev) =>
        prev.map((row) =>
          row.id === res.id
            ? {
                ...row,
                webhookUrl: res.webhookUrl,
                webhookSecretConfigured: res.webhookSecretConfigured,
              }
            : row,
        ),
      );
      setWebhookSecretInput('');
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setWebhookSaving(false);
    }
  }

  function openWebhookEditor(r: PartnerKeyRow) {
    setSubmitErr(null);
    setWebhookEditId(r.id);
    setWebhookUrlInput(r.webhookUrl ?? '');
    setWebhookSecretInput('');
    setAllowlistCidrsInput(r.allowedIpCidrs ?? '');
  }

  function closeWebhookEditor() {
    setWebhookEditId(null);
    setWebhookUrlInput('');
    setWebhookSecretInput('');
    setAllowlistCidrsInput('');
  }

  async function revoke(id: string) {
    if (!window.confirm(t('desk.organization.partnerApiRevokeConfirm'))) {
      return;
    }
    setRevokingId(id);
    setSubmitErr(null);
    try {
      const r = await apiFetch(`/companies/${encodeURIComponent(companyId)}/partner-api-keys/${id}`, {
        method: 'DELETE',
      });
      if (r.status === 401) {
        throw new Error(translateDeskApiError('Session expired or invalid'));
      }
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(translateDeskApiError(txt || r.statusText));
      }
      await load();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setRevokingId(null);
    }
  }

  if (!canView) {
    return null;
  }

  return (
    <section style={{ marginTop: '1.25rem' }}>
      <h3 style={{ fontSize: '1.02rem', margin: '0 0 0.35rem' }}>{t('desk.organization.partnerApiTitle')}</h3>
      <p className="desk-muted" style={{ margin: '0 0 0.75rem', maxWidth: '44rem', fontSize: '0.9rem' }}>
        {t('desk.organization.partnerApiHint')}
      </p>
      {!canEdit && (
        <p className="desk-muted" style={{ margin: '0 0 0.65rem', maxWidth: '44rem', fontSize: '0.88rem' }}>
          {t('desk.organization.partnerApiReadonlyBanner')}
        </p>
      )}
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {submitErr && <p className="desk-err">{submitErr}</p>}
      {plaintextKey && (
        <div
          style={{
            marginBottom: '0.85rem',
            padding: '0.65rem 0.75rem',
            border: '1px solid var(--desk-border, #ccc)',
            borderRadius: '6px',
            maxWidth: '44rem',
            background: 'var(--desk-panel-bg, rgba(0,0,0,0.03))',
          }}
        >
          <p className="desk-muted" style={{ margin: '0 0 0.4rem', fontSize: '0.88rem' }}>
            {t('desk.organization.partnerApiSecretOnce')}
          </p>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              fontSize: '0.82rem',
              marginBottom: '0.5rem',
            }}
          >
            {plaintextKey}
          </code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(plaintextKey);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t('desk.organization.partnerApiCopied') : t('desk.organization.partnerApiCopy')}
          </button>
        </div>
      )}
      {oauthSecretOnce && (
        <div
          style={{
            marginBottom: '0.85rem',
            padding: '0.65rem 0.75rem',
            border: '1px solid var(--desk-border, #ccc)',
            borderRadius: '6px',
            maxWidth: '44rem',
            background: 'var(--desk-panel-bg, rgba(0,0,0,0.03))',
          }}
        >
          <p className="desk-muted" style={{ margin: '0 0 0.4rem', fontSize: '0.88rem' }}>
            {t('desk.organization.partnerApiOauth.secretOnce')}
          </p>
          <p className="desk-muted" style={{ margin: '0 0 0.25rem', fontSize: '0.8rem' }}>
            {t('desk.organization.partnerApiOauth.clientIdLabel')}
          </p>
          <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            {oauthSecretOnce.clientId}
          </code>
          <p className="desk-muted" style={{ margin: '0 0 0.25rem', fontSize: '0.8rem' }}>
            {t('desk.organization.partnerApiOauth.clientSecretLabel')}
          </p>
          <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            {oauthSecretOnce.clientSecret}
          </code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `client_id=${oauthSecretOnce.clientId}\nclient_secret=${oauthSecretOnce.clientSecret}`,
                );
                setOauthCopied(true);
              } catch {
                setOauthCopied(false);
              }
            }}
          >
            {oauthCopied ? t('desk.organization.partnerApiCopied') : t('desk.organization.partnerApiCopy')}
          </button>
        </div>
      )}
      {canEdit && (
        <form onSubmit={onCreate} className="desk-tool" style={{ marginBottom: '0.85rem', gap: '0.5rem' }}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t('desk.organization.partnerApiNamePh')}
            maxLength={120}
            style={{ minWidth: '16rem' }}
            disabled={saving}
            aria-label={t('desk.organization.partnerApiNamePh')}
          />
          <button type="submit" disabled={saving || !nameInput.trim()}>
            {saving ? t('desk.ui.buttonBusy') : t('desk.organization.partnerApiCreate')}
          </button>
        </form>
      )}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && rows.length === 0 && !loadErr && (
        <p className="desk-muted">{t('desk.organization.partnerApiNoKeys')}</p>
      )}
      {!loading && rows.length > 0 && (
        <div className="desk-table-wrap">
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.organization.partnerApiTh.name')}</th>
                <th>{t('desk.organization.partnerApiTh.id')}</th>
                <th>{t('desk.organization.partnerApiTh.webhookUrl')}</th>
                <th>{t('desk.organization.partnerApiTh.webhookSecret')}</th>
                <th>{t('desk.organization.partnerApiTh.allowedIp')}</th>
                <th>{t('desk.organization.partnerApiTh.oauth')}</th>
                <th>{t('desk.organization.partnerApiTh.created')}</th>
                <th>{t('desk.organization.partnerApiTh.lastUsed')}</th>
                <th>{t('desk.organization.partnerApiTh.revoked')}</th>
                {canEdit && <th>{t('desk.organization.th.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{r.name}</td>
                    <td>
                      <code style={{ fontSize: '0.8rem' }}>{r.maskedKey}</code>
                    </td>
                    <td
                      className="desk-muted"
                      style={{ fontSize: '0.8rem', maxWidth: '14rem', wordBreak: 'break-all' }}
                      title={r.webhookUrl ?? undefined}
                    >
                      {truncateUrl(r.webhookUrl) || t('desk.fleet.quote.emDash')}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.webhookSecretConfigured
                        ? t('desk.organization.partnerApiWebhook.yes')
                        : t('desk.organization.partnerApiWebhook.no')}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.8rem', maxWidth: '10rem' }}>
                      {r.allowedIpCidrs?.trim()
                        ? t('desk.organization.partnerApiAllowlist.configured')
                        : t('desk.fleet.quote.emDash')}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.oauthClientConfigured
                        ? t('desk.organization.partnerApiWebhook.yes')
                        : t('desk.organization.partnerApiWebhook.no')}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {fmtDt(r.createdAt)}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.lastUsedAt ? fmtDt(r.lastUsedAt) : t('desk.fleet.quote.emDash')}
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                      {r.revokedAt ? fmtDt(r.revokedAt) : t('desk.fleet.quote.emDash')}
                    </td>
                    {canEdit && (
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={
                              r.revokedAt != null || webhookSaving || allowlistSaving || oauthSaving
                            }
                            onClick={() =>
                              webhookEditId === r.id ? closeWebhookEditor() : openWebhookEditor(r)
                            }
                          >
                            {webhookEditId === r.id
                              ? t('desk.organization.partnerApiWebhook.cancel')
                              : t('desk.organization.partnerApiWebhook.open')}
                          </button>
                          <button
                            type="button"
                            disabled={r.revokedAt != null || revokingId === r.id || allowlistSaving || oauthSaving}
                            onClick={() => void revoke(r.id)}
                          >
                            {revokingId === r.id ? t('desk.ui.buttonBusy') : t('desk.organization.partnerApiRevoke')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {canEdit && webhookEditId === r.id && (
                    <tr>
                      <td colSpan={10} style={{ background: 'var(--desk-panel-bg, rgba(0,0,0,0.03))' }}>
                        <div
                          className="desk-tool"
                          style={{
                            flexWrap: 'wrap',
                            alignItems: 'flex-end',
                            gap: '0.5rem',
                            padding: '0.5rem 0',
                          }}
                        >
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                              {t('desk.organization.partnerApiTh.webhookUrl')}
                            </span>
                            <input
                              value={webhookUrlInput}
                              onChange={(e) => setWebhookUrlInput(e.target.value)}
                              placeholder={t('desk.organization.partnerApiWebhook.urlPh')}
                              maxLength={2048}
                              disabled={webhookSaving || allowlistSaving || oauthSaving}
                              style={{ minWidth: 'min(100%, 22rem)' }}
                              autoComplete="off"
                              aria-label={t('desk.organization.partnerApiWebhook.urlPh')}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                              {t('desk.organization.partnerApiTh.webhookSecret')}
                            </span>
                            <input
                              type="password"
                              value={webhookSecretInput}
                              onChange={(e) => setWebhookSecretInput(e.target.value)}
                              placeholder={t('desk.organization.partnerApiWebhook.secretPh')}
                              maxLength={512}
                              disabled={webhookSaving || allowlistSaving || oauthSaving}
                              style={{ minWidth: 'min(100%, 18rem)' }}
                              autoComplete="new-password"
                              aria-label={t('desk.organization.partnerApiWebhook.secretPh')}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={webhookSaving || allowlistSaving || oauthSaving}
                            onClick={() => void saveWebhook(r.id)}
                          >
                            {webhookSaving ? t('desk.ui.buttonBusy') : t('desk.organization.partnerApiWebhook.save')}
                          </button>
                          <button
                            type="button"
                            disabled={webhookSaving || allowlistSaving || oauthSaving || !r.webhookSecretConfigured}
                            onClick={() => void clearWebhookSecretOnly(r.id)}
                          >
                            {t('desk.organization.partnerApiWebhook.clearSecret')}
                          </button>
                        </div>
                        <label
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem',
                            marginTop: '0.65rem',
                            maxWidth: 'min(100%, 40rem)',
                          }}
                        >
                          <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                            {t('desk.organization.partnerApiAllowlist.label')}
                          </span>
                          <textarea
                            value={allowlistCidrsInput}
                            onChange={(e) => setAllowlistCidrsInput(e.target.value)}
                            placeholder={t('desk.organization.partnerApiAllowlist.placeholder')}
                            rows={2}
                            maxLength={8000}
                            disabled={allowlistSaving || webhookSaving || oauthSaving}
                            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }}
                            aria-label={t('desk.organization.partnerApiAllowlist.label')}
                          />
                          <span className="desk-muted" style={{ fontSize: '0.75rem' }}>
                            {t('desk.organization.partnerApiAllowlist.hint')}
                          </span>
                          <button
                            type="button"
                            disabled={allowlistSaving || webhookSaving || oauthSaving}
                            onClick={() => void saveAllowlist(r.id)}
                          >
                            {allowlistSaving
                              ? t('desk.ui.buttonBusy')
                              : t('desk.organization.partnerApiAllowlist.save')}
                          </button>
                        </label>
                        <div style={{ marginTop: '0.85rem', maxWidth: 'min(100%, 40rem)' }}>
                          <p className="desk-muted" style={{ margin: '0 0 0.35rem', fontSize: '0.75rem' }}>
                            {t('desk.organization.partnerApiOauth.intro')}
                          </p>
                          <button
                            type="button"
                            disabled={allowlistSaving || webhookSaving || oauthSaving}
                            onClick={() => void regenerateOauthSecret(r.id)}
                          >
                            {oauthSaving ? t('desk.ui.buttonBusy') : t('desk.organization.partnerApiOauth.generate')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
