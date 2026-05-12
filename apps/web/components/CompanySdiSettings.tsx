'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { sdiAdapterValues, updateCompanySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { formatDeskSdiAdapter } from '../lib/desk-organization-adapter-labels';
import type { Me } from '../lib/me-types';

type Sdi = (typeof sdiAdapterValues)[number];

type CompanySdi = {
  id: string;
  sdiAdapter: Sdi;
  sdiHttpUrl: string | null;
};

function canEditCompanySettings(me: Me, companyId: string): boolean {
  if (me.role === 'ADMIN') {
    return true;
  }
  if (me.role === 'BRANCH_MANAGER' && me.companyId === companyId) {
    return true;
  }
  return false;
}

type Props = { me: Me; companyId: string };

export function CompanySdiSettings({ me, companyId }: Props) {
  const { t } = usePublicLocaleContext();
  const [sdiAdapter, setSdiAdapter] = useState<Sdi>('OFF');
  const [sdiHttpUrl, setSdiHttpUrl] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canEdit = canEditCompanySettings(me, companyId);

  useEffect(() => {
    let c = false;
    setLoading(true);
    void (async () => {
      try {
        const co = await apiJson<CompanySdi>(`/companies/${companyId}`);
        if (c) return;
        setSdiAdapter(co.sdiAdapter);
        setSdiHttpUrl(co.sdiHttpUrl ?? '');
        setLoadErr(null);
      } catch (e) {
        if (!c) setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [companyId, t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    const p = updateCompanySchema.safeParse({
      sdiAdapter,
      sdiHttpUrl: sdiHttpUrl.trim() || null,
    });
    if (!p.success) {
      setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
      return;
    }
    setSaving(true);
    try {
      await apiJson(`/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify(p.data) });
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="desk-muted">{t('desk.organization.sdi.loading')}</p>;
  }
  if (loadErr) {
    return <p className="desk-err">{loadErr}</p>;
  }

  return (
    <div className="desk-form-panel" style={{ marginTop: '0.75rem', maxWidth: '36rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('desk.organization.sdi.title')}</h3>
      <p className="desk-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        {t('desk.organization.sdi.intro')}
      </p>
      {canEdit ? (
        <form className="desk-form" onSubmit={onSubmit} style={{ gap: '0.6rem' }}>
          <label>
            {t('desk.organization.sdi.adapter')}
            <select
              value={sdiAdapter}
              onChange={(e) => setSdiAdapter(e.target.value as Sdi)}
            >
              <option value="OFF">{t('desk.organization.sdi.optOff')}</option>
              <option value="MOCK">{t('desk.organization.sdi.optMock')}</option>
              <option value="HTTP">{t('desk.organization.sdi.optHttp')}</option>
            </select>
          </label>
          <label>
            {t('desk.organization.sdi.url')}
            <input
              value={sdiHttpUrl}
              onChange={(e) => setSdiHttpUrl(e.target.value)}
              placeholder={t('desk.organization.sdi.urlPh')}
            />
          </label>
          {submitErr && <p className="desk-err" style={{ margin: 0 }}>{submitErr}</p>}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('desk.organization.sdi.saving') : t('desk.organization.sdi.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
          {t('desk.organization.sdi.readonlyAdapter')}{' '}
          <code title={sdiAdapter}>{formatDeskSdiAdapter(sdiAdapter, t)}</code>
        </p>
      )}
    </div>
  );
}
