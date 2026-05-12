'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { createVehicleClassSchema, putVehicleClassSeasonalRatesBodySchema, updateVehicleClassSchema } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import type { PublicMessageKey } from '../lib/public-messages';
import type { Me } from '../lib/me-types';

type VehicleClassRow = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  defaultDailyCents: number | null;
  defaultDepositCents: number | null;
  seasonalRates?: {
    id: string;
    validFrom: string;
    validTo: string;
    dailyCents: number;
    priority: number;
  }[];
};

const empty = {
  name: '',
  code: '',
  defaultDailyCents: '',
  defaultDepositCents: '',
};

const emptySeason = () => ({
  validFrom: '',
  validTo: '',
  dailyCents: '',
  priority: '0',
});

export function canWriteVehicleClasses(me: Me): boolean {
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

function parseOptionalCents(
  s: string,
  fieldTranslated: string,
  t: (k: PublicMessageKey) => string,
): { value?: number; err?: string } {
  const d = s.trim();
  if (d === '') {
    return {};
  }
  const n = Number.parseInt(d, 10);
  if (Number.isNaN(n) || n < 0) {
    return { err: t('desk.fleet.vclass.errFieldNonNeg').replace('{field}', fieldTranslated) };
  }
  return { value: n };
}

type SeasonRow = ReturnType<typeof emptySeason>;

function buildSeasonalRatesPayload(
  rows: SeasonRow[],
  msg: {
    incomplete: string;
    dailyNonNeg: string;
    priorityNonNeg: string;
    fromBeforeTo: string;
    invalidFallback: string;
  },
): { ok: true; rates: { validFrom: string; validTo: string; dailyCents: number; priority: number }[] } | { ok: false; err: string } {
  const out: { validFrom: string; validTo: string; dailyCents: number; priority: number }[] = [];
  for (const row of rows) {
    const vf = row.validFrom.trim();
    const vt = row.validTo.trim();
    const dc = row.dailyCents.trim();
    const pr = row.priority.trim();
    if (vf === '' && vt === '' && dc === '' && (pr === '' || pr === '0')) {
      continue;
    }
    if (vf === '' || vt === '' || dc === '') {
      return { ok: false, err: msg.incomplete };
    }
    const n = Number.parseInt(dc, 10);
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, err: msg.dailyNonNeg };
    }
    const p = pr === '' ? 0 : Number.parseInt(pr, 10);
    if (Number.isNaN(p) || p < 0) {
      return { ok: false, err: msg.priorityNonNeg };
    }
    if (vf > vt) {
      return { ok: false, err: msg.fromBeforeTo };
    }
    out.push({ validFrom: vf, validTo: vt, dailyCents: n, priority: p });
  }
  const p = putVehicleClassSeasonalRatesBodySchema.safeParse({ rates: out });
  if (!p.success) {
    return { ok: false, err: p.error.issues[0]?.message ?? msg.invalidFallback };
  }
  return { ok: true, rates: p.data.rates };
}

function isoToDateInput(s: string): string {
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function VehicleClassForm({ me, companyId, open, editingId, onClose, onSaved }: Props) {
  const { t } = usePublicLocaleContext();
  const [values, setValues] = useState({ ...empty });
  const [seasonRows, setSeasonRows] = useState<ReturnType<typeof emptySeason>[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codeDisplay, setCodeDisplay] = useState('');

  const isEdit = Boolean(editingId);
  const canWrite = canWriteVehicleClasses(me);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitErr(null);
    if (!editingId) {
      setValues({ ...empty });
      setSeasonRows([emptySeason()]);
      return;
    }
    let c = false;
    setLoading(true);
    (async () => {
      try {
        const row = await apiJson<VehicleClassRow>(`/vehicle-classes/${editingId}`);
        if (c) return;
        setCodeDisplay(row.code);
        setValues({
          name: row.name,
          code: row.code,
          defaultDailyCents:
            row.defaultDailyCents != null ? String(row.defaultDailyCents) : '',
          defaultDepositCents:
            row.defaultDepositCents != null ? String(row.defaultDepositCents) : '',
        });
        if (row.seasonalRates && row.seasonalRates.length > 0) {
          setSeasonRows(
            row.seasonalRates.map((r) => ({
              validFrom: isoToDateInput(
                typeof r.validFrom === 'string' ? r.validFrom : String(r.validFrom),
              ),
              validTo: isoToDateInput(typeof r.validTo === 'string' ? r.validTo : String(r.validTo)),
              dailyCents: String(r.dailyCents),
              priority: String(r.priority),
            })),
          );
        } else {
          setSeasonRows([emptySeason()]);
        }
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
      const seasonMsg = {
        incomplete: t('desk.fleet.vclass.seasonErrIncomplete'),
        dailyNonNeg: t('desk.fleet.vclass.seasonErrDaily'),
        priorityNonNeg: t('desk.fleet.vclass.seasonErrPriority'),
        fromBeforeTo: t('desk.fleet.vclass.seasonErrRange'),
        invalidFallback: t('desk.fleet.vclass.seasonErrInvalid'),
      };
      const ex = buildSeasonalRatesPayload(seasonRows, seasonMsg);
      if (!ex.ok) {
        setSubmitErr(ex.err);
        return;
      }
      if (isEdit && editingId) {
        const d1 = parseOptionalCents(values.defaultDailyCents, t('desk.fleet.vclass.errLabelDaily'), t);
        if (d1.err) {
          setSubmitErr(d1.err);
          return;
        }
        const d2 = parseOptionalCents(values.defaultDepositCents, t('desk.fleet.vclass.errLabelDeposit'), t);
        if (d2.err) {
          setSubmitErr(d2.err);
          return;
        }
        const raw: Record<string, unknown> = { name: values.name.trim() };
        if (d1.value !== undefined) {
          raw.defaultDailyCents = d1.value;
        }
        if (d2.value !== undefined) {
          raw.defaultDepositCents = d2.value;
        }
        const p = updateVehicleClassSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson<VehicleClassRow>(`/vehicle-classes/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(p.data),
        });
        await apiJson<VehicleClassRow>(`/vehicle-classes/${editingId}/seasonal-rates`, {
          method: 'PUT',
          body: JSON.stringify({ rates: ex.rates }),
        });
      } else {
        const d1 = parseOptionalCents(values.defaultDailyCents, t('desk.fleet.vclass.errLabelDaily'), t);
        if (d1.err) {
          setSubmitErr(d1.err);
          return;
        }
        const d2 = parseOptionalCents(values.defaultDepositCents, t('desk.fleet.vclass.errLabelDeposit'), t);
        if (d2.err) {
          setSubmitErr(d2.err);
          return;
        }
        const raw: Record<string, unknown> = {
          companyId,
          name: values.name.trim(),
          code: values.code.trim(),
        };
        if (d1.value !== undefined) {
          raw.defaultDailyCents = d1.value;
        }
        if (d2.value !== undefined) {
          raw.defaultDepositCents = d2.value;
        }
        const p = createVehicleClassSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        const created = await apiJson<VehicleClassRow>('/vehicle-classes', {
          method: 'POST',
          body: JSON.stringify(p.data),
        });
        await apiJson<VehicleClassRow>(`/vehicle-classes/${created.id}/seasonal-rates`, {
          method: 'PUT',
          body: JSON.stringify({ rates: ex.rates }),
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
      <div className="desk-form-panel" role="region" aria-label={t('desk.fleet.vclass.aria.edit')}>
        <p className="desk-muted">{t('desk.fleet.vclass.loading')}</p>
        {loadErr && <p className="desk-err">{loadErr}</p>}
      </div>
    );
  }

  if (isEdit && loadErr) {
    return (
      <div className="desk-form-panel" role="region">
        <p className="desk-err">{loadErr}</p>
        <button type="button" onClick={onClose}>
          {t('desk.fleet.vclass.close')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="desk-form-panel"
      role="region"
      aria-label={isEdit ? t('desk.fleet.vclass.aria.edit') : t('desk.fleet.vclass.aria.new')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
        {isEdit ? t('desk.fleet.vclass.editTitle') : t('desk.fleet.vclass.newTitle')}
      </h3>
      <form className="desk-form" onSubmit={onSubmit}>
        {isEdit && (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            {t('desk.fleet.vclass.codeLocked')} <code>{codeDisplay}</code>
          </p>
        )}
        {!isEdit && (
          <label>
            {t('desk.fleet.vclass.fieldCode')}
            <input
              value={values.code}
              onChange={(e) => setField('code', e.target.value)}
              required
              minLength={1}
              maxLength={32}
              autoComplete="off"
              placeholder={t('desk.fleet.vclass.codePh')}
            />
          </label>
        )}
        <label>
          {t('desk.fleet.vclass.fieldName')}
          <input
            value={values.name}
            onChange={(e) => setField('name', e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.vclass.fieldDaily')}
            <input
              type="text"
              inputMode="numeric"
              value={values.defaultDailyCents}
              onChange={(e) => setField('defaultDailyCents', e.target.value)}
              placeholder={t('desk.fleet.vclass.dailyPh')}
            />
          </label>
          <label>
            {t('desk.fleet.vclass.fieldDeposit')}
            <input
              type="text"
              inputMode="numeric"
              value={values.defaultDepositCents}
              onChange={(e) => setField('defaultDepositCents', e.target.value)}
              placeholder={t('desk.fleet.vclass.depositPh')}
            />
          </label>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          <p style={{ margin: '0 0 0.35rem 0', fontSize: '0.9rem' }} className="desk-muted">
            {t('desk.fleet.vclass.seasonBlurb')}
          </p>
          {seasonRows.map((row, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 0.5fr auto',
                gap: '0.4rem',
                alignItems: 'end',
                marginBottom: '0.35rem',
              }}
            >
              <label>
                {t('desk.fleet.vclass.seasonFrom')}
                <input
                  type="date"
                  value={row.validFrom}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSeasonRows((prev) => prev.map((p, i) => (i === idx ? { ...p, validFrom: v } : p)));
                  }}
                />
              </label>
              <label>
                {t('desk.fleet.vclass.seasonTo')}
                <input
                  type="date"
                  value={row.validTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSeasonRows((prev) => prev.map((p, i) => (i === idx ? { ...p, validTo: v } : p)));
                  }}
                />
              </label>
              <label>
                {t('desk.fleet.vclass.seasonDaily')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.dailyCents}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSeasonRows((prev) => prev.map((p, i) => (i === idx ? { ...p, dailyCents: v } : p)));
                  }}
                  placeholder={t('desk.fleet.vclass.seasonDailyPh')}
                />
              </label>
              <label>
                {t('desk.fleet.vclass.seasonPri')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.priority}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSeasonRows((prev) => prev.map((p, i) => (i === idx ? { ...p, priority: v } : p)));
                  }}
                  title={t('desk.fleet.vclass.seasonPriTitle')}
                />
              </label>
              {seasonRows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSeasonRows((prev) => prev.filter((_, i) => i !== idx));
                  }}
                >
                  {t('desk.fleet.vclass.removeRow')}
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSeasonRows((prev) => [...prev, emptySeason()])}
            style={{ marginTop: '0.2rem' }}
          >
            {t('desk.fleet.vclass.addSeasonRow')}
          </button>
        </div>
        {submitErr && (
          <p className="desk-err" role="alert">
            {submitErr}
          </p>
        )}
        <div className="desk-form-actions">
          <button type="submit" disabled={saving}>
            {saving
              ? t('desk.fleet.vclass.saving')
              : isEdit
                ? t('desk.fleet.vclass.saveChanges')
                : t('desk.fleet.vclass.create')}
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            {t('desk.fleet.vclass.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
