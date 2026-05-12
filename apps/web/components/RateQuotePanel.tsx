'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiJson } from '../lib/api';
import { formatDeskPricingModel } from '../lib/desk-pricing-model-label';
import type { Me } from '../lib/me-types';
import { getVatRate, vatFromNetCents } from '../lib/vat-display';

type ClassOption = { id: string; name: string; code: string };
type StationRow = { id: string; name: string; code: string };

type QuoteResult = {
  vehicleClassId: string;
  rentalDays: number;
  defaultDailyCents: number | null;
  subtotalCents: number | null;
  oneWayCents: number;
  totalCents: number | null;
  defaultDepositCents: number | null;
  currency: string;
  pricingModel: string;
  pickupAt: string;
  returnAt: string;
};

function eur(cents: number | null | undefined) {
  if (cents == null) {
    return '—';
  }
  return `${(cents / 100).toFixed(2)} EUR`;
}

type Props = {
  companyId: string;
  classes: ClassOption[];
  /** When set, pickup station defaults to this branch and (for agents) cannot be changed */
  me?: Me | null;
};

export function RateQuotePanel({ companyId, classes, me }: Props) {
  const { t } = usePublicLocaleContext();
  const [stations, setStations] = useState<StationRow[]>([]);
  const [vehicleClassId, setVehicleClassId] = useState('');
  const [pickupStationId, setPickupStationId] = useState('');
  const [returnStationId, setReturnStationId] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [returnAt, setReturnAt] = useState('');
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lockPickup =
    me != null && me.role === 'AGENT' && me.stationId != null;

  useEffect(() => {
    if (!companyId) {
      return;
    }
    let c = false;
    (async () => {
      try {
        const st = await apiJson<StationRow[]>(`/stations?companyId=${encodeURIComponent(companyId)}`);
        if (c) return;
        setStations(st);
      } catch {
        if (!c) setStations([]);
      }
    })();
    return () => {
      c = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!lockPickup || !me?.stationId) {
      return;
    }
    setPickupStationId(me.stationId);
    setReturnStationId((r) => (r === '' ? me.stationId! : r));
  }, [lockPickup, me?.stationId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    if (!vehicleClassId) {
      setErr(t('desk.fleet.quote.errSelectClass'));
      return;
    }
    const hasPu = Boolean(pickupStationId);
    const hasRet = Boolean(returnStationId);
    if (hasPu !== hasRet) {
      setErr(t('desk.fleet.quote.errStationsBothOrNone'));
      return;
    }
    const a = new Date(pickupAt);
    const b = new Date(returnAt);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
      setErr(t('desk.fleet.quote.errDateTime'));
      return;
    }
    if (a >= b) {
      setErr(t('desk.fleet.quote.errReturnAfterPickup'));
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({
        vehicleClassId,
        pickupAt: a.toISOString(),
        returnAt: b.toISOString(),
      });
      if (pickupStationId && returnStationId) {
        p.set('pickupStationId', pickupStationId);
        p.set('returnStationId', returnStationId);
      } else if (lockPickup && me?.stationId) {
        p.set('pickupStationId', me.stationId);
        p.set('returnStationId', me.stationId);
      }
      const q = await apiJson<QuoteResult>(`/rates/quote?${p.toString()}`);
      setResult(q);
    } catch (er) {
      setResult(null);
      setErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }

  if (classes.length === 0) {
    return (
      <p className="desk-muted" style={{ margin: 0 }}>
        {t('desk.fleet.quote.needClasses')}
      </p>
    );
  }

  return (
    <div
      className="desk-form-panel"
      style={{ maxWidth: '32rem' }}
      role="region"
      aria-label={t('desk.fleet.quote.aria')}
    >
      <form className="desk-form" onSubmit={onSubmit}>
        <label>
          {t('desk.fleet.quote.fieldClass')}
          <select
            value={vehicleClassId}
            onChange={(e) => {
              setVehicleClassId(e.target.value);
            }}
            required
          >
            <option value="">{t('desk.fleet.quote.selectPlaceholder')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.quote.pickupStation')}
            <select
              value={pickupStationId}
              onChange={(e) => {
                setPickupStationId(e.target.value);
              }}
              disabled={lockPickup}
            >
              <option value="">{t('desk.fleet.quote.emDash')}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.fleet.quote.returnStation')}
            <select
              value={returnStationId}
              onChange={(e) => {
                setReturnStationId(e.target.value);
              }}
            >
              <option value="">{t('desk.fleet.quote.emDash')}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.fleet.quote.pickupLocal')}
            <input
              type="datetime-local"
              value={pickupAt}
              onChange={(e) => {
                setPickupAt(e.target.value);
              }}
              required
            />
          </label>
          <label>
            {t('desk.fleet.quote.returnLocal')}
            <input
              type="datetime-local"
              value={returnAt}
              onChange={(e) => {
                setReturnAt(e.target.value);
              }}
              required
            />
          </label>
        </div>
        {err && <p className="desk-err" role="alert">{err}</p>}
        <div className="desk-form-actions">
          <button type="submit" disabled={loading}>
            {loading ? t('desk.fleet.quote.quoting') : t('desk.fleet.quote.getQuote')}
          </button>
        </div>
      </form>
      {result && (() => {
        const vatRate = getVatRate();
        const rent = result.subtotalCents;
        const ow = result.oneWayCents ?? 0;
        const net = (rent ?? 0) + ow;
        const vatLine = net > 0 && vatRate > 0 ? vatFromNetCents(net, vatRate) : null;
        const em = t('desk.fleet.quote.emDash');
        const vatLabel = t('desk.fleet.quote.resultVat').replace(
          '{rate}',
          (vatRate * 100).toFixed(0),
        );
        return (
        <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}>
            <strong>{t('desk.fleet.quote.resultModel')}</strong>{' '}
            <code title={result.pricingModel}>{formatDeskPricingModel(result.pricingModel, t)}</code> ·{' '}
            <strong>{t('desk.fleet.quote.resultDays')}</strong> {result.rentalDays} ·{' '}
            <strong>{t('desk.fleet.quote.resultCurrency')}</strong> {result.currency}
          </p>
          <p style={{ margin: '0.35rem 0 0' }}>
            <strong>{t('desk.fleet.quote.resultDaily')}</strong> {eur(result.defaultDailyCents)} ·{' '}
            <strong>{t('desk.fleet.quote.resultRentNet')}</strong> {rent != null ? eur(rent) : em} ·{' '}
            <strong>{t('desk.fleet.quote.resultOneWay')}</strong> {ow > 0 ? eur(ow) : em}
          </p>
          <p style={{ margin: '0.35rem 0 0' }}>
            <strong>{t('desk.fleet.quote.resultLineNet')}</strong>{' '}
            {result.totalCents != null ? eur(result.totalCents) : em} ·{' '}
            <strong>{t('desk.fleet.quote.resultDeposit')}</strong> {eur(result.defaultDepositCents)}
          </p>
          {vatLine && (
            <p style={{ margin: '0.35rem 0 0' }}>
              <strong>{vatLabel}</strong> {eur(vatLine.vatCents)} ·{' '}
              <strong>{t('desk.fleet.quote.resultGross')}</strong> {eur(vatLine.grossCents)}
            </p>
          )}
          <p className="desk-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
            {t('desk.fleet.quote.vatNote')}
          </p>
        </div>
        );
      })()}
    </div>
  );
}
