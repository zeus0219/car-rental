'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createStationSchema, updateStationSchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { Me } from '../lib/me-types';

type Station = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  timeZone: string;
  cargosLocationCode?: string | null;
};

const empty: Omit<Station, 'id' | 'companyId'> = {
  name: '',
  code: '',
  addressLine: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'IT',
  timeZone: 'Europe/Rome',
  cargosLocationCode: '',
};

export function canWriteStations(me: Me): boolean {
  return me.role !== 'READONLY_ACCOUNTING';
}

type Props = {
  me: Me;
  companyId: string;
  open: boolean;
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function StationForm({ me, companyId, open, editingId, onClose, onSaved }: Props) {
  const { t } = usePublicLocaleContext();
  const [values, setValues] = useState({ ...empty });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const isEdit = Boolean(editingId);
  const canWrite = canWriteStations(me);
  /** Display only in edit; not sent on PATCH. */
  const [codeDisplay, setCodeDisplay] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitErr(null);
    if (!editingId) {
      setValues({ ...empty });
      return;
    }
    let c = false;
    setLoading(true);
    (async () => {
      try {
        const s = await apiJson<Station>(`/stations/${editingId}`);
        if (c) return;
        setCodeDisplay(s.code);
        setValues({
          name: s.name,
          code: s.code,
          addressLine: s.addressLine,
          city: s.city,
          province: s.province,
          postalCode: s.postalCode,
          country: s.country,
          timeZone: s.timeZone,
          cargosLocationCode: s.cargosLocationCode ?? '',
        });
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
  }, [open, editingId, t]);

  if (!open || !canWrite) {
    return null;
  }

  function setField<K extends keyof typeof values>(k: K, v: (typeof values)[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    setSaving(true);
    try {
      if (isEdit && editingId) {
        const p = updateStationSchema.safeParse({
          name: values.name,
          addressLine: values.addressLine,
          city: values.city,
          province: values.province,
          postalCode: values.postalCode,
          country: values.country,
          timeZone: values.timeZone,
          cargosLocationCode: values.cargosLocationCode?.trim() || null,
        });
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        if (Object.keys(p.data).length === 0) {
          onClose();
          return;
        }
        await apiJson<Station>(`/stations/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(p.data),
        });
      } else {
        const p = createStationSchema.safeParse({
          companyId,
          name: values.name,
          code: values.code,
          addressLine: values.addressLine,
          city: values.city,
          province: values.province,
          postalCode: values.postalCode,
          country: values.country,
          timeZone: values.timeZone,
          ...(values.cargosLocationCode?.trim()
            ? { cargosLocationCode: values.cargosLocationCode.trim() }
            : {}),
        });
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson<Station>('/stations', {
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

  if (isEdit && loading) {
    return (
      <div className="desk-form-panel" role="region" aria-label={t('desk.organization.station.aria.edit')}>
        <p className="desk-muted">{t('desk.organization.station.loading')}</p>
        {loadErr && <p className="desk-err">{loadErr}</p>}
      </div>
    );
  }

  if (isEdit && loadErr) {
    return (
      <div className="desk-form-panel" role="region">
        <p className="desk-err">{loadErr}</p>
        <button type="button" onClick={onClose}>
          {t('desk.organization.station.close')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="desk-form-panel"
      role="region"
      aria-label={isEdit ? t('desk.organization.station.aria.edit') : t('desk.organization.station.aria.new')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
        {isEdit ? t('desk.organization.station.editTitle') : t('desk.organization.station.newTitle')}
      </h3>
      <form className="desk-form" onSubmit={onSubmit}>
        {isEdit && (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            {t('desk.organization.station.codeLabel')} <code>{codeDisplay}</code>
          </p>
        )}
        {!isEdit && (
          <label>
            {t('desk.organization.station.fieldCode')}
            <input
              value={values.code}
              onChange={(e) => setField('code', e.target.value)}
              required
              minLength={1}
              maxLength={32}
              autoComplete="off"
            />
          </label>
        )}
        <label>
          {t('desk.organization.station.fieldName')}
          <input
            value={values.name}
            onChange={(e) => setField('name', e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label>
          {t('desk.organization.station.fieldAddress')}
          <input
            value={values.addressLine}
            onChange={(e) => setField('addressLine', e.target.value)}
            required
            maxLength={500}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.organization.station.fieldCity')}
            <input
              value={values.city}
              onChange={(e) => setField('city', e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            {t('desk.organization.station.fieldProvince')}
            <input
              value={values.province}
              onChange={(e) => setField('province', e.target.value)}
              required
              maxLength={4}
            />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.organization.station.fieldPostal')}
            <input
              value={values.postalCode}
              onChange={(e) => setField('postalCode', e.target.value)}
              required
              maxLength={10}
            />
          </label>
          <label>
            {t('desk.organization.station.fieldCountry')}
            <input
              value={values.country}
              onChange={(e) => setField('country', e.target.value.toUpperCase().slice(0, 2))}
              required
              minLength={2}
              maxLength={2}
            />
          </label>
        </div>
        <label>
          {t('desk.organization.station.fieldTimeZone')}
          <input
            value={values.timeZone}
            onChange={(e) => setField('timeZone', e.target.value)}
            required
            placeholder={t('desk.organization.station.timeZonePh')}
          />
        </label>
        <label>
          {t('desk.organization.station.cargosLead')} <code>stationCargosLocationCode</code>
          <input
            value={values.cargosLocationCode ?? ''}
            onChange={(e) => setField('cargosLocationCode', e.target.value)}
            maxLength={32}
            placeholder={t('desk.organization.station.optionalPh')}
            autoComplete="off"
          />
        </label>
        {submitErr && <p className="desk-err" role="alert">{submitErr}</p>}
        <div className="desk-form-actions">
          <button type="submit" disabled={saving}>
            {saving
              ? t('desk.organization.station.saving')
              : isEdit
                ? t('desk.organization.station.saveChanges')
                : t('desk.organization.station.create')}
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            {t('desk.organization.station.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
