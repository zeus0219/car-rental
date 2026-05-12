'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { updateCompanySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { formatDeskCargosAdapter } from '../lib/desk-organization-adapter-labels';
import type { Me } from '../lib/me-types';

type CompanyCargos = {
  id: string;
  cargosInScope: boolean;
  cargosEnvironment: 'TEST' | 'PRODUCTION';
  cargosAdapter: 'MOCK' | 'HTTP' | 'OFF';
  cargosHttpUrl: string | null;
  cargosCutoffMinutesBeforePickup: number | null;
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

type Props = {
  me: Me;
  companyId: string;
};

export function CompanyCargosSettings({ me, companyId }: Props) {
  const { t } = usePublicLocaleContext();
  const [cargosInScope, setCargosInScope] = useState(true);
  const [cargosEnvironment, setCargosEnvironment] = useState<'TEST' | 'PRODUCTION'>('TEST');
  const [cargosAdapter, setCargosAdapter] = useState<'MOCK' | 'HTTP' | 'OFF'>('MOCK');
  const [cargosHttpUrl, setCargosHttpUrl] = useState('');
  const [cutoffMin, setCutoffMin] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const canEdit = canEditCompanySettings(me, companyId);

  useEffect(() => {
    let c = false;
    setLoading(true);
    (async () => {
      try {
        const co = await apiJson<CompanyCargos>(`/companies/${companyId}`);
        if (c) return;
        setCargosInScope(co.cargosInScope);
        setCargosEnvironment(co.cargosEnvironment);
        setCargosAdapter(co.cargosAdapter);
        setCargosHttpUrl(co.cargosHttpUrl ?? '');
        setCutoffMin(
          co.cargosCutoffMinutesBeforePickup != null ? String(co.cargosCutoffMinutesBeforePickup) : '',
        );
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
    const raw = cutoffMin.trim();
    let cutoff: number | null;
    if (raw === '') {
      cutoff = null;
    } else {
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) {
        setSubmitErr(t('desk.organization.cargos.errCutoff'));
        return;
      }
      cutoff = n;
    }
    const p = updateCompanySchema.safeParse({
      cargosInScope,
      cargosEnvironment,
      cargosAdapter,
      cargosHttpUrl: cargosHttpUrl.trim() || null,
      cargosCutoffMinutesBeforePickup: cutoff,
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
    return <p className="desk-muted">{t('desk.organization.cargos.loading')}</p>;
  }
  if (loadErr) {
    return <p className="desk-err">{loadErr}</p>;
  }

  return (
    <div
      className="desk-form-panel"
      style={{ marginTop: '0.75rem', maxWidth: '36rem' }}
    >
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('desk.organization.cargos.title')}</h3>
      <p className="desk-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        {t('desk.organization.cargos.intro')}
      </p>
      <details
        className="desk-muted"
        style={{
          marginTop: '0.65rem',
          marginBottom: '0.25rem',
          fontSize: '0.82rem',
          maxWidth: '34rem',
        }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
          {t('desk.organization.cargos.d6Summary')}
        </summary>
        <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.organization.cargos.d6Lead')}</p>
        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
          <li>{t('desk.organization.cargos.d6Item1')}</li>
          <li>{t('desk.organization.cargos.d6Item2')}</li>
          <li>{t('desk.organization.cargos.d6Item3')}</li>
          <li>{t('desk.organization.cargos.d6Item4')}</li>
          <li>{t('desk.organization.cargos.d6Item5')}</li>
          <li>{t('desk.organization.cargos.d6Item6')}</li>
          <li>{t('desk.organization.cargos.d6Item7')}</li>
          <li>{t('desk.organization.cargos.d6Item8')}</li>
        </ul>
      </details>
      {canEdit ? (
        <form className="desk-form" onSubmit={onSubmit} style={{ gap: '0.6rem' }}>
          <label>
            {t('desk.organization.cargos.inScope')}
            <select
              value={cargosInScope ? '1' : '0'}
              onChange={(e) => setCargosInScope(e.target.value === '1')}
            >
              <option value="1">{t('desk.organization.cargos.inScopeYes')}</option>
              <option value="0">{t('desk.organization.cargos.inScopeNo')}</option>
            </select>
          </label>
          <label>
            {t('desk.organization.cargos.environment')}
            <select
              value={cargosEnvironment}
              onChange={(e) => setCargosEnvironment(e.target.value as 'TEST' | 'PRODUCTION')}
            >
              <option value="TEST">{t('desk.organization.cargos.optEnvTest')}</option>
              <option value="PRODUCTION">{t('desk.organization.cargos.optEnvProd')}</option>
            </select>
          </label>
          <label>
            {t('desk.organization.cargos.adapter')}
            <select
              value={cargosAdapter}
              onChange={(e) => setCargosAdapter(e.target.value as 'MOCK' | 'HTTP' | 'OFF')}
            >
              <option value="MOCK">{t('desk.organization.cargos.optMock')}</option>
              <option value="HTTP">{t('desk.organization.cargos.optHttp')}</option>
              <option value="OFF">{t('desk.organization.cargos.optOff')}</option>
            </select>
          </label>
          <label>
            {t('desk.organization.cargos.url')}
            <input
              value={cargosHttpUrl}
              onChange={(e) => setCargosHttpUrl(e.target.value)}
              placeholder={t('desk.organization.cargos.urlPh')}
            />
          </label>
          <label>
            {t('desk.organization.cargos.cutoff')}
            <input
              value={cutoffMin}
              onChange={(e) => setCutoffMin(e.target.value)}
              inputMode="numeric"
              placeholder={t('desk.organization.cargos.cutoffPh')}
            />
          </label>
          {submitErr && <p className="desk-err" style={{ margin: 0 }}>{submitErr}</p>}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('desk.organization.cargos.saving') : t('desk.organization.cargos.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
          {t('desk.organization.cargos.lblInScope')}{' '}
          <code>{cargosInScope ? t('desk.organization.cargos.yes') : t('desk.organization.cargos.no')}</code> ·{' '}
          {t('desk.organization.cargos.lblEnv')}{' '}
          <code>
            {cargosEnvironment === 'TEST'
              ? t('desk.organization.cargos.optEnvTest')
              : t('desk.organization.cargos.optEnvProd')}
          </code>{' '}
          · {t('desk.organization.cargos.lblAdapter')}{' '}
          <code title={cargosAdapter}>{formatDeskCargosAdapter(cargosAdapter, t)}</code>
        </p>
      )}
    </div>
  );
}
