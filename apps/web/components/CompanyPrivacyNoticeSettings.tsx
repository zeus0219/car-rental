'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createCompanyPrivacyNoticeBodySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { Me } from '../lib/me-types';

function canEditCompanySettings(me: Me, companyId: string): boolean {
  if (me.role === 'ADMIN') {
    return true;
  }
  if (me.role === 'BRANCH_MANAGER' && me.companyId === companyId) {
    return true;
  }
  return false;
}

type Row = {
  id: string;
  version: string;
  policyUrl: string | null;
  effectiveFrom: string | null;
  notes: string | null;
  updatedAt: string;
};

type Props = {
  me: Me;
  companyId: string;
};

export function CompanyPrivacyNoticeSettings({ me, companyId }: Props) {
  const { t } = usePublicLocaleContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState('');
  const [policyUrl, setPolicyUrl] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canEdit = canEditCompanySettings(me, companyId);

  const load = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setLoading(true);
    try {
      const list = await apiJson<Row[]>(`/companies/${encodeURIComponent(companyId)}/privacy-notices`);
      setRows(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    const p = createCompanyPrivacyNoticeBodySchema.safeParse({
      version,
      policyUrl: policyUrl.trim() || undefined,
      effectiveFrom: effectiveFrom.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    if (!p.success) {
      setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
      return;
    }
    setSaving(true);
    try {
      await apiJson(`/companies/${encodeURIComponent(companyId)}/privacy-notices`, {
        method: 'POST',
        body: JSON.stringify(p.data),
      });
      setVersion('');
      setPolicyUrl('');
      setEffectiveFrom('');
      setNotes('');
      void load();
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: '1rem', maxWidth: '48rem' }}>
      <h3 style={{ fontSize: '1rem' }}>{t('desk.organization.privacyRegister.title')}</h3>
      <p className="desk-muted" style={{ fontSize: '0.88rem' }}>
        {t('desk.organization.privacyRegister.lead')}
      </p>
      {loadErr && <p className="desk-err">{loadErr}</p>}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && !loadErr && rows.length === 0 && (
        <p className="desk-muted" style={{ marginTop: '0.5rem' }}>
          {t('desk.organization.privacyRegister.empty')}
        </p>
      )}
      {!loading && rows.length > 0 && (
        <div className="desk-table-wrap" style={{ marginTop: '0.5rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.organization.privacyRegister.th.version')}</th>
                <th>{t('desk.organization.privacyRegister.th.url')}</th>
                <th>{t('desk.organization.privacyRegister.th.effective')}</th>
                <th>{t('desk.organization.privacyRegister.th.notes')}</th>
                {canEdit && <th>{t('desk.organization.th.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.version}</code>
                  </td>
                  <td>
                    {r.policyUrl ? (
                      <a href={r.policyUrl} target="_blank" rel="noopener noreferrer">
                        {t('desk.organization.privacyRegister.link')}
                      </a>
                    ) : (
                      <span className="desk-muted">—</span>
                    )}
                  </td>
                  <td className="desk-muted" style={{ fontSize: '0.85rem' }}>
                    {r.effectiveFrom
                      ? new Date(r.effectiveFrom).toLocaleDateString(undefined, {
                          dateStyle: 'medium',
                        })
                      : '—'}
                  </td>
                  <td className="desk-muted" style={{ fontSize: '0.85rem', maxWidth: '14rem' }}>
                    {r.notes ?? '—'}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            if (!window.confirm(t('desk.organization.privacyRegister.confirmDelete'))) {
                              return;
                            }
                            setSubmitErr(null);
                            try {
                              await apiJson(
                                `/companies/${encodeURIComponent(companyId)}/privacy-notices/${encodeURIComponent(r.id)}`,
                                { method: 'DELETE' },
                              );
                              void load();
                            } catch (er) {
                              setSubmitErr(
                                er instanceof Error ? er.message : t('desk.err.generic'),
                              );
                            }
                          })();
                        }}
                      >
                        {t('desk.organization.privacyRegister.delete')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form className="desk-form" style={{ marginTop: '0.75rem' }} onSubmit={onSubmit}>
          <label>
            {t('desk.organization.privacyRegister.field.version')}
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              maxLength={64}
              required
              placeholder={t('desk.customers.form.privacyVersionPh')}
            />
          </label>
          <label>
            {t('desk.organization.privacyRegister.field.url')}
            <input
              value={policyUrl}
              onChange={(e) => setPolicyUrl(e.target.value)}
              maxLength={512}
              placeholder="https://…"
              type="url"
            />
          </label>
          <label>
            {t('desk.organization.privacyRegister.field.effective')}
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label>
            {t('desk.organization.privacyRegister.field.notes')}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </label>
          {submitErr && <p className="desk-err">{submitErr}</p>}
          <button type="submit" disabled={saving}>
            {saving ? t('desk.ui.buttonBusy') : t('desk.organization.privacyRegister.add')}
          </button>
        </form>
      )}
    </div>
  );
}
