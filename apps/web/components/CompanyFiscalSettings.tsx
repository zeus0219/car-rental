'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { updateCompanySchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { Me } from '../lib/me-types';

type CompanyRow = {
  id: string;
  fiscalCode: string | null;
  vatNumber: string | null;
  sdiRecipientCode: string | null;
  pec: string | null;
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

export function CompanyFiscalSettings({ me, companyId }: Props) {
  const { t } = usePublicLocaleContext();
  const [fiscalCode, setFiscalCode] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [sdiRecipientCode, setSdiRecipientCode] = useState('');
  const [pec, setPec] = useState('');
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
        setFiscalCode(co.fiscalCode ?? '');
        setVatNumber(co.vatNumber ?? '');
        setSdiRecipientCode(co.sdiRecipientCode ?? '');
        setPec(co.pec ?? '');
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
    const raw = {
      fiscalCode: fiscalCode.trim() === '' ? null : fiscalCode,
      vatNumber: vatNumber.trim() === '' ? null : vatNumber,
      sdiRecipientCode: sdiRecipientCode.trim() === '' ? null : sdiRecipientCode,
      pec: pec.trim() === '' ? null : pec,
    };
    const p = updateCompanySchema.safeParse(raw);
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
    return <p className="desk-muted" style={{ margin: 0 }}>{t('desk.organization.fiscal.loading')}</p>;
  }
  if (loadErr) {
    return <p className="desk-err" style={{ margin: 0 }}>{loadErr}</p>;
  }

  const roVal = (s: string) => (s.trim() === '' ? t('desk.organization.fiscal.readonlyNone') : s);

  return (
    <div
      className="desk-form-panel"
      style={{ maxWidth: '36rem', marginTop: '0.5rem' }}
      role="region"
      aria-label={t('desk.organization.fiscal.aria')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('desk.organization.fiscal.title')}</h3>
      <p className="desk-muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
        {t('desk.organization.fiscal.blurb')}
      </p>
      {canEdit ? (
        <form className="desk-form" onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label>
              {t('desk.customers.form.fiscalCode')}
              <input
                value={fiscalCode}
                onChange={(e) => setFiscalCode(e.target.value)}
                maxLength={32}
                placeholder={t('desk.customers.form.fiscalCodePh')}
                autoComplete="off"
              />
            </label>
            <label>
              {t('desk.customers.form.vat')}
              <input
                value={vatNumber}
                onChange={(e) => setVatNumber(e.target.value)}
                maxLength={20}
                placeholder={t('desk.customers.form.vatPh')}
                autoComplete="off"
              />
            </label>
            <label>
              {t('desk.customers.form.sdi')}
              <input
                value={sdiRecipientCode}
                onChange={(e) => setSdiRecipientCode(e.target.value)}
                maxLength={10}
                placeholder={t('desk.customers.form.sdiPh')}
                autoComplete="off"
              />
            </label>
            <label>
              {t('desk.customers.form.pec')}
              <input
                type="email"
                value={pec}
                onChange={(e) => setPec(e.target.value)}
                maxLength={320}
                placeholder={t('desk.customers.form.pecPh')}
                autoComplete="off"
              />
            </label>
          </div>
          {submitErr && (
            <p className="desk-err" role="alert">
              {submitErr}
            </p>
          )}
          <div className="desk-form-actions">
            <button type="submit" disabled={saving}>
              {saving ? t('desk.organization.fiscal.saving') : t('desk.organization.fiscal.save')}
            </button>
          </div>
        </form>
      ) : (
        <dl style={{ margin: 0, fontSize: '0.9rem', display: 'grid', rowGap: '0.35rem' }}>
          <div>
            <dt className="desk-muted" style={{ display: 'inline', marginRight: '0.35rem' }}>
              {t('desk.customers.form.fiscalCode')}
            </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{roVal(fiscalCode)}</dd>
          </div>
          <div>
            <dt className="desk-muted" style={{ display: 'inline', marginRight: '0.35rem' }}>
              {t('desk.customers.form.vat')}
            </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{roVal(vatNumber)}</dd>
          </div>
          <div>
            <dt className="desk-muted" style={{ display: 'inline', marginRight: '0.35rem' }}>
              {t('desk.customers.form.sdi')}
            </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{roVal(sdiRecipientCode)}</dd>
          </div>
          <div>
            <dt className="desk-muted" style={{ display: 'inline', marginRight: '0.35rem' }}>
              {t('desk.customers.form.pec')}
            </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{roVal(pec)}</dd>
          </div>
          <p className="desk-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            {t('desk.organization.fiscal.readonlyHint')}
          </p>
        </dl>
      )}
    </div>
  );
}
