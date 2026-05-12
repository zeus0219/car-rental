'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  createVehicleSchema,
  updateVehicleSchema,
  vehicleRentPricingModeValues,
  vehicleStatusValues,
  vehicleTypeValues,
} from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import {
  formatDeskVehicleRentMode,
  formatDeskVehicleStatus,
  formatDeskVehicleType,
} from '../lib/desk-fleet-vehicle-labels';
import type { Me } from '../lib/me-types';

type StationRow = { id: string; name: string; code: string };
type ClassRow = { id: string; name: string; code: string };

type VehicleOne = {
  id: string;
  companyId: string;
  vehicleClassId: string;
  homeStationId: string;
  licensePlate: string;
  vehicleType: (typeof vehicleTypeValues)[number];
  status: (typeof vehicleStatusValues)[number];
  odometerKm: number;
  acquiredAt: string | null;
  nextServiceDueOdometerKm: number | null;
  autoServiceBlockHours: number | null;
  vin: string | null;
  fuelType: string | null;
  modelLabel: string | null;
  coverImageUrl: string | null;
  rentPricingMode: (typeof vehicleRentPricingModeValues)[number];
  rentOverrideDailyCents: number | null;
  flatTripRentCents: number | null;
};

const empty = {
  licensePlate: '',
  vehicleClassId: '',
  homeStationId: '',
  vehicleType: 'CAR' as (typeof vehicleTypeValues)[number],
  vin: '',
  status: 'AVAILABLE' as (typeof vehicleStatusValues)[number],
  odometerKm: '0',
  acquiredAt: '',
  nextServiceDueOdometerKm: '',
  autoServiceBlockHours: '',
  fuelType: '',
  modelLabel: '',
  coverImageUrl: '',
  rentPricingMode: 'USE_CLASS',
  rentOverrideDailyCents: '',
  flatTripRentCents: '',
};

export function canWriteVehicles(me: Me): boolean {
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

export function VehicleForm({ me, companyId, open, editingId, onClose, onSaved }: Props) {
  const { t } = usePublicLocaleContext();
  const [values, setValues] = useState({ ...empty });
  const [stations, setStations] = useState<StationRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [optsErr, setOptsErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [optsLoading, setOptsLoading] = useState(false);

  const isEdit = Boolean(editingId);
  const canWrite = canWriteVehicles(me);
  const lockHomeStation = me.role === 'AGENT' && me.stationId != null;

  useEffect(() => {
    if (!open || !companyId) {
      return;
    }
    let c = false;
    setOptsLoading(true);
    (async () => {
      try {
        const [st, cl] = await Promise.all([
          apiJson<StationRow[]>(`/stations?companyId=${encodeURIComponent(companyId)}`),
          apiJson<ClassRow[]>(`/vehicle-classes?companyId=${encodeURIComponent(companyId)}`),
        ]);
        if (c) return;
        setStations(st);
        setClasses(cl);
        setOptsErr(null);
      } catch (e) {
        if (!c) setOptsErr(e instanceof Error ? e.message : t('desk.err.generic'));
      } finally {
        if (!c) setOptsLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [open, companyId, t]);

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
        const row = await apiJson<VehicleOne>(`/vehicles/${editingId}`);
        if (c) return;
        setValues({
          licensePlate: row.licensePlate,
          vehicleClassId: row.vehicleClassId,
          homeStationId: row.homeStationId,
          vehicleType: row.vehicleType,
          status: row.status,
          odometerKm: String(row.odometerKm),
          acquiredAt: row.acquiredAt ? row.acquiredAt.slice(0, 10) : '',
          nextServiceDueOdometerKm:
            row.nextServiceDueOdometerKm != null ? String(row.nextServiceDueOdometerKm) : '',
          autoServiceBlockHours:
            row.autoServiceBlockHours != null ? String(row.autoServiceBlockHours) : '',
          vin: row.vin ?? '',
          fuelType: row.fuelType ?? '',
          modelLabel: row.modelLabel ?? '',
          coverImageUrl: row.coverImageUrl ?? '',
          rentPricingMode: row.rentPricingMode,
          rentOverrideDailyCents:
            row.rentOverrideDailyCents != null ? String(row.rentOverrideDailyCents) : '',
          flatTripRentCents: row.flatTripRentCents != null ? String(row.flatTripRentCents) : '',
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

  useEffect(() => {
    if (!open || editingId) {
      return;
    }
    if (!me.stationId) {
      return;
    }
    setValues((prev) => {
      if (prev.homeStationId !== '') {
        return prev;
      }
      return { ...prev, homeStationId: me.stationId! };
    });
  }, [open, editingId, me.stationId]);

  if (!open || !canWrite) {
    return null;
  }

  function setField<K extends keyof typeof values>(k: K, v: (typeof values)[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function parseNextServiceKm(): { ok: true; n: number | null } | { ok: false; err: string } {
    const raw = values.nextServiceDueOdometerKm.trim();
    if (raw === '') {
      return { ok: true, n: null };
    }
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, err: t('desk.fleet.vehicle.errNextService') };
    }
    return { ok: true, n };
  }

  function parseAutoServiceHours():
    | { ok: true; n: number | null }
    | { ok: false; err: string } {
    const raw = values.autoServiceBlockHours.trim();
    if (raw === '') {
      return { ok: true, n: null };
    }
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > 336) {
      return { ok: false, err: t('desk.fleet.vehicle.errAutoServiceHours') };
    }
    return { ok: true, n };
  }

  function parseOdometer(): { ok: true; n: number } | { ok: false; err: string } {
    const raw = values.odometerKm.trim();
    if (raw === '') {
      return { ok: true, n: 0 };
    }
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, err: t('desk.fleet.vehicle.errOdometer') };
    }
    return { ok: true, n };
  }

  function buildRentPricingPayload():
    | { error: string }
    | {
        rentPricingMode: (typeof vehicleRentPricingModeValues)[number];
        rentOverrideDailyCents: number | null;
        flatTripRentCents: number | null;
      } {
    const mode = values.rentPricingMode;
    if (mode === 'USE_CLASS') {
      return {
        rentPricingMode: 'USE_CLASS',
        rentOverrideDailyCents: null,
        flatTripRentCents: null,
      };
    }
    if (mode === 'FIXED_DAILY') {
      const raw = values.rentOverrideDailyCents.trim();
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) {
        return { error: t('desk.fleet.vehicle.errPricingCents') };
      }
      return { rentPricingMode: 'FIXED_DAILY', rentOverrideDailyCents: n, flatTripRentCents: null };
    }
    const raw = values.flatTripRentCents.trim();
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) {
      return { error: t('desk.fleet.vehicle.errPricingCents') };
    }
    return { rentPricingMode: 'FLAT_TRIP', rentOverrideDailyCents: null, flatTripRentCents: n };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (!isEdit && (classes.length === 0 || stations.length === 0)) {
      setSubmitErr(t('desk.fleet.vehicle.errNeedClassStation'));
      return;
    }
    const odo = parseOdometer();
    if (!odo.ok) {
      setSubmitErr(odo.err);
      return;
    }
    const ns = parseNextServiceKm();
    if (!ns.ok) {
      setSubmitErr(ns.err);
      return;
    }
    const ash = parseAutoServiceHours();
    if (!ash.ok) {
      setSubmitErr(ash.err);
      return;
    }
    const rent = buildRentPricingPayload();
    if ('error' in rent) {
      setSubmitErr(rent.error);
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editingId) {
        const raw = {
          vehicleClassId: values.vehicleClassId,
          homeStationId: values.homeStationId,
          licensePlate: values.licensePlate.trim(),
          vehicleType: values.vehicleType,
          status: values.status,
          odometerKm: odo.n,
          acquiredAt:
            values.acquiredAt.trim() === ''
              ? null
              : new Date(`${values.acquiredAt.trim()}T12:00:00.000Z`),
          nextServiceDueOdometerKm: ns.n,
          autoServiceBlockHours: ash.n,
          vin: values.vin.trim() === '' ? null : values.vin.trim(),
          fuelType: values.fuelType.trim() === '' ? null : values.fuelType.trim(),
          modelLabel: values.modelLabel.trim() === '' ? null : values.modelLabel.trim(),
          coverImageUrl:
            values.coverImageUrl.trim() === '' ? null : (values.coverImageUrl.trim() as string),
          ...rent,
        };
        const p = updateVehicleSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson<VehicleOne>(`/vehicles/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(p.data),
        });
      } else {
        const raw: Record<string, unknown> = {
          companyId,
          vehicleClassId: values.vehicleClassId,
          homeStationId: values.homeStationId,
          licensePlate: values.licensePlate.trim(),
          vehicleType: values.vehicleType,
        };
        if (values.vin.trim() !== '') {
          raw.vin = values.vin.trim();
        }
        raw.status = values.status;
        if (values.odometerKm.trim() !== '') {
          raw.odometerKm = odo.n;
        }
        if (values.fuelType.trim() !== '') {
          raw.fuelType = values.fuelType.trim();
        }
        if (values.modelLabel.trim() !== '') {
          raw.modelLabel = values.modelLabel.trim();
        }
        if (values.coverImageUrl.trim() !== '') {
          raw.coverImageUrl = values.coverImageUrl.trim();
        }
        if (values.acquiredAt.trim() !== '') {
          raw.acquiredAt = new Date(`${values.acquiredAt.trim()}T12:00:00.000Z`);
        }
        if (ns.n != null) {
          raw.nextServiceDueOdometerKm = ns.n;
        }
        if (ash.n != null) {
          raw.autoServiceBlockHours = ash.n;
        }
        Object.assign(raw, rent);
        const p = createVehicleSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson('/vehicles', {
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
      <div className="desk-form-panel" role="region" aria-label={t('desk.fleet.vehicle.aria.edit')}>
        <p className="desk-muted">{t('desk.fleet.vehicle.loading')}</p>
        {loadErr && <p className="desk-err">{loadErr}</p>}
      </div>
    );
  }

  if (isEdit && loadErr) {
    return (
      <div className="desk-form-panel" role="region">
        <p className="desk-err">{loadErr}</p>
        <button type="button" onClick={onClose}>
          {t('desk.fleet.vehicle.close')}
        </button>
      </div>
    );
  }

  const canCreate = !isEdit && classes.length > 0 && stations.length > 0;

  return (
    <div
      className="desk-form-panel"
      role="region"
      aria-label={isEdit ? t('desk.fleet.vehicle.aria.edit') : t('desk.fleet.vehicle.aria.new')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
        {isEdit ? t('desk.fleet.vehicle.editTitle') : t('desk.fleet.vehicle.newTitle')}
      </h3>
      {optsLoading && <p className="desk-muted">{t('desk.fleet.vehicle.optsLoading')}</p>}
      {optsErr && <p className="desk-err">{optsErr}</p>}
      <form className="desk-form" onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.vehicle.fieldPlate')}
            <input
              value={values.licensePlate}
              onChange={(e) => setField('licensePlate', e.target.value.toUpperCase())}
              required
              maxLength={20}
              autoComplete="off"
            />
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldModel')}
            <input
              value={values.modelLabel}
              onChange={(e) => setField('modelLabel', e.target.value)}
              maxLength={200}
            />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.vehicle.fieldClass')}
            <select
              value={values.vehicleClassId}
              onChange={(e) => setField('vehicleClassId', e.target.value)}
              required
              disabled={!classes.length}
            >
              <option value="">{t('desk.fleet.vehicle.selectClass')}</option>
              {classes.map((cRow) => (
                <option key={cRow.id} value={cRow.id}>
                  {cRow.name} ({cRow.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldStation')}
            <select
              value={values.homeStationId}
              onChange={(e) => setField('homeStationId', e.target.value)}
              required
              disabled={!stations.length || lockHomeStation}
            >
              <option value="">{t('desk.fleet.vehicle.selectStation')}</option>
              {stations.map((sRow) => (
                <option key={sRow.id} value={sRow.id}>
                  {sRow.name} ({sRow.code})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.vehicle.fieldType')}
            <select
              value={values.vehicleType}
              onChange={(e) => setField('vehicleType', e.target.value as (typeof values)['vehicleType'])}
            >
              {vehicleTypeValues.map((vt) => (
                <option key={vt} value={vt}>
                  {formatDeskVehicleType(vt, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldStatus')}
            <select
              value={values.status}
              onChange={(e) => setField('status', e.target.value as (typeof values)['status'])}
            >
              {vehicleStatusValues.map((st) => (
                <option key={st} value={st}>
                  {formatDeskVehicleStatus(st, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldOdo')}
            <input
              type="text"
              inputMode="numeric"
              value={values.odometerKm}
              onChange={(e) => setField('odometerKm', e.target.value)}
            />
          </label>
        </div>
        <p className="desk-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
          {t('desk.fleet.vehicle.odoHint')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.vehicle.fieldAcquired')}
            <input
              type="date"
              value={values.acquiredAt}
              onChange={(e) => setField('acquiredAt', e.target.value)}
            />
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldNextServiceKm')}
            <input
              type="text"
              inputMode="numeric"
              value={values.nextServiceDueOdometerKm}
              onChange={(e) => setField('nextServiceDueOdometerKm', e.target.value)}
              placeholder={t('desk.fleet.vehicle.phNextServiceKm')}
            />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: '0.35rem' }}>
          {t('desk.fleet.vehicle.fieldAutoServiceHours')}
          <input
            type="text"
            inputMode="numeric"
            value={values.autoServiceBlockHours}
            onChange={(e) => setField('autoServiceBlockHours', e.target.value)}
            placeholder={t('desk.fleet.vehicle.phAutoServiceHours')}
            style={{ maxWidth: '12rem' }}
          />
        </label>
        <p className="desk-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', maxWidth: '44rem' }}>
          {t('desk.fleet.vehicle.autoServiceHint')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label style={{ gridColumn: '1 / -1' }}>
            {t('desk.fleet.vehicle.fieldCover')}
            <input
              type="url"
              value={values.coverImageUrl}
              onChange={(e) => setField('coverImageUrl', e.target.value)}
              maxLength={2048}
              placeholder={t('desk.fleet.vehicle.phCoverUrl')}
              autoComplete="off"
            />
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldVin')}
            <input
              value={values.vin}
              onChange={(e) => setField('vin', e.target.value)}
              maxLength={32}
              autoComplete="off"
            />
          </label>
          <label>
            {t('desk.fleet.vehicle.fieldFuel')}
            <input
              value={values.fuelType}
              onChange={(e) => setField('fuelType', e.target.value)}
              maxLength={40}
            />
          </label>
        </div>
        <fieldset
          style={{
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 4,
            padding: '0.75rem',
            marginTop: '0.5rem',
          }}
        >
          <legend style={{ fontSize: '0.9rem', padding: '0 0.25rem' }}>
            {t('desk.fleet.vehicle.pricingLegend')}
          </legend>
          <p className="desk-muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
            {t('desk.fleet.vehicle.pricingHint')}
          </p>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            {t('desk.fleet.vehicle.fieldRentMode')}
            <select
              value={values.rentPricingMode}
              onChange={(e) =>
                setField(
                  'rentPricingMode',
                  e.target.value as (typeof vehicleRentPricingModeValues)[number],
                )
              }
            >
              {vehicleRentPricingModeValues.map((m) => (
                <option key={m} value={m}>
                  {formatDeskVehicleRentMode(m, t)}
                </option>
              ))}
            </select>
          </label>
          {values.rentPricingMode === 'FIXED_DAILY' && (
            <label style={{ display: 'block' }}>
              {t('desk.fleet.vehicle.fieldRentDailyCents')}
              <input
                inputMode="numeric"
                value={values.rentOverrideDailyCents}
                onChange={(e) => setField('rentOverrideDailyCents', e.target.value)}
                placeholder={t('desk.fleet.vehicle.phRentDailyCents')}
                autoComplete="off"
              />
            </label>
          )}
          {values.rentPricingMode === 'FLAT_TRIP' && (
            <label style={{ display: 'block' }}>
              {t('desk.fleet.vehicle.fieldRentFlatCents')}
              <input
                inputMode="numeric"
                value={values.flatTripRentCents}
                onChange={(e) => setField('flatTripRentCents', e.target.value)}
                placeholder={t('desk.fleet.vehicle.phRentFlatCents')}
                autoComplete="off"
              />
            </label>
          )}
        </fieldset>
        {submitErr && (
          <p className="desk-err" role="alert">
            {submitErr}
          </p>
        )}
        <div className="desk-form-actions">
          <button type="submit" disabled={saving || (!isEdit && !canCreate)}>
            {saving
              ? t('desk.fleet.vehicle.saving')
              : isEdit
                ? t('desk.fleet.vehicle.saveChanges')
                : t('desk.fleet.vehicle.create')}
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            {t('desk.fleet.vehicle.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
