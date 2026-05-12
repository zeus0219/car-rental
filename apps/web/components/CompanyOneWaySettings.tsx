'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { updateCompanySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { Me } from '../lib/me-types';

type CompanyRow = {
  id: string;
  name: string;
  oneWayFeeCents: number | null;
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

export function CompanyOneWaySettings({ me, companyId }: Props) {
  const { t } = usePublicLocaleContext();
  const [oneWay, setOneWay] = useState('');
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
        const co = await apiJson<CompanyRow>(`/companies/${companyId}`);
        if (c) return;
        setOneWay(co.oneWayFeeCents != null ? String(co.oneWayFeeCents) : '');
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
    const raw = oneWay.trim();
    let oneWayVal: number | null;
    if (raw === '') {
      oneWayVal = null;
    } else {
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) {
        setSubmitErr(t('desk.organization.oneWay.errInvalid'));
        return;
      }
      oneWayVal = n;
    }
    const p = updateCompanySchema.safeParse({ oneWayFeeCents: oneWayVal });
    if (!p.success) {
      setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
      return;
    }
    setSaving(true);
    try {
      await apiJson(`/companies/${companyId}`, {
        method: 'PATCH',
        body: JSON.stringify(p.data),
      });
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="desk-muted" style={{ margin: 0 }}>{t('desk.organization.oneWay.loading')}</p>;
  }
  if (loadErr) {
    return <p className="desk-err" style={{ margin: 0 }}>{loadErr}</p>;
  }

  return (
    <div
      className="desk-form-panel"
      style={{ maxWidth: '28rem', marginTop: '0.5rem' }}
      role="region"
      aria-label={t('desk.organization.oneWay.aria')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('desk.organization.oneWay.title')}</h3>
      <p className="desk-muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
        {t('desk.organization.oneWay.blurb')}
      </p>
      {canEdit ? (
        <form className="desk-form" onSubmit={onSubmit}>
          <label>
            {t('desk.organization.oneWay.feeLabel')}
            <input
              type="text"
              inputMode="numeric"
              value={oneWay}
              onChange={(e) => {
                setOneWay(e.target.value);
              }}
              placeholder={t('desk.organization.oneWay.placeholder')}
            />
          </label>
          {submitErr && <p className="desk-err" role="alert">{submitErr}</p>}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('desk.organization.oneWay.saving') : t('desk.organization.oneWay.save')}
            </button>
          </div>
        </form>
      ) : (
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          {t('desk.organization.oneWay.readonlyLead')}{' '}
          <strong>
            {oneWay.trim() === ''
              ? t('desk.organization.oneWay.readonlyNone')
              : t('desk.organization.oneWay.readonlyCents').replace('{n}', oneWay.trim())}{' '}
            {t('desk.organization.oneWay.readonlyHint')}
          </strong>
        </p>
      )}
    </div>
  );
}
