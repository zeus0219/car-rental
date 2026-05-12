'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { formatDeskCalendarBlockType } from '../../../lib/desk-calendar-block-type';
import { formatDeskReservationStatus } from '../../../lib/desk-reservation-status-label';
import type { PublicLocale } from '../../../lib/public-locale';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type VehicleRow = {
  id: string;
  licensePlate: string;
  modelLabel: string | null;
  coverImageUrl: string | null;
};

type CalReservation = {
  id: string;
  vehicleId: string;
  pickupAt: string;
  returnAt: string;
  status: string;
  customer?: { name: string } | null;
};

type CalBlock = {
  id: string;
  vehicleId: string;
  startsAt: string;
  endsAt: string;
  type: string;
  reason?: string | null;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function clipSegment(
  rangeStart: Date,
  rangeEnd: Date,
  segStart: Date,
  segEnd: Date,
): { left: number; width: number } | null {
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();
  const ss = segStart.getTime();
  const se = segEnd.getTime();
  const s = Math.max(ss, rs);
  const e = Math.min(se, re);
  if (e <= s) {
    return null;
  }
  const total = re - rs;
  return {
    left: ((s - rs) / total) * 100,
    width: ((e - s) / total) * 100,
  };
}

function reservationBarClass(status: string): string {
  switch (status) {
    case 'IN_PROGRESS':
      return 'fleet-cal-bar--inprog';
    case 'CONFIRMED':
      return 'fleet-cal-bar--confirmed';
    case 'PENDING_PAYMENT':
      return 'fleet-cal-bar--pending';
    case 'QUOTE':
      return 'fleet-cal-bar--quote';
    case 'COMPLETED':
      return 'fleet-cal-bar--done';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'fleet-cal-bar--muted';
    default:
      return 'fleet-cal-bar--quote';
  }
}

function formatRangeLabel(locale: PublicLocale, from: Date, to: Date): string {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  const o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
  return `${from.toLocaleDateString(loc, o)} — ${to.toLocaleDateString(loc, o)}`;
}

export default function DeskCalendarPage() {
  const { t, locale } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [reservations, setReservations] = useState<CalReservation[]>([]);
  const [blocks, setBlocks] = useState<CalBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const range = useMemo(() => {
    const rangeStart = startOfDay(anchor);
    const rangeEnd = addLocalDays(rangeStart, 14);
    return { rangeStart, rangeEnd };
  }, [anchor]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const fromIso = range.rangeStart.toISOString();
      const toIso = range.rangeEnd.toISOString();
      const qCo = encodeURIComponent(companyId);
      const [ve, res, bl] = await Promise.all([
        apiJson<VehicleRow[]>(`/vehicles?companyId=${qCo}`),
        apiJson<CalReservation[]>(
          `/reservations?companyId=${qCo}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
        ),
        apiJson<CalBlock[]>(`/calendar-blocks?companyId=${qCo}`),
      ]);
      setVehicles(ve);
      setReservations(res);
      setBlocks(bl);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, range.rangeStart, range.rangeEnd]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void load();
  }, [ready, companyId, load]);

  const byVehicleRes = useMemo(() => {
    const m = new Map<string, CalReservation[]>();
    for (const r of reservations) {
      const arr = m.get(r.vehicleId) ?? [];
      arr.push(r);
      m.set(r.vehicleId, arr);
    }
    return m;
  }, [reservations]);

  const byVehicleBlocks = useMemo(() => {
    const m = new Map<string, CalBlock[]>();
    for (const b of blocks) {
      const arr = m.get(b.vehicleId) ?? [];
      arr.push(b);
      m.set(b.vehicleId, arr);
    }
    return m;
  }, [blocks]);

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return <p className="desk-err">{t('desk.err.generic')}</p>;

  return (
    <div>
      <h1 className="dash-title">{t('desk.calendar.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '52rem' }}>
        {t('desk.calendar.intro')}
      </p>

      <div style={{ marginTop: '1rem' }}>
        <CompanyScopeSelect me={me} companies={companies} companyId={companyId} onChange={setCompanyId} />
      </div>
      {scopeErr && <p className="desk-err">{scopeErr}</p>}
      {err && <p className="desk-err">{err}</p>}

      {ready && companyId && (
        <>
          <div className="fleet-cal-toolbar">
            <button type="button" className="fleet-cal-btn" onClick={() => setAnchor((a) => addLocalDays(a, -7))}>
              {t('desk.calendar.prev')}
            </button>
            <button type="button" className="fleet-cal-btn" onClick={() => setAnchor(startOfDay(new Date()))}>
              {t('desk.calendar.today')}
            </button>
            <button type="button" className="fleet-cal-btn" onClick={() => setAnchor((a) => addLocalDays(a, 7))}>
              {t('desk.calendar.next')}
            </button>
            <button type="button" className="fleet-cal-btn" onClick={() => void load()} disabled={loading}>
              {loading ? t('desk.calendar.loading') : t('desk.calendar.refresh')}
            </button>
            <span className="desk-muted fleet-cal-range">
              {formatRangeLabel(locale, range.rangeStart, addLocalDays(range.rangeStart, 13))}
            </span>
          </div>

          <div className="fleet-cal-legend">
            <span>
              <span className="fleet-cal-legend-swatch fleet-cal-bar--confirmed" /> {t('desk.calendar.legend.res')}
            </span>
            <span>
              <span className="fleet-cal-legend-swatch fleet-cal-block" /> {t('desk.calendar.legend.block')}
            </span>
          </div>

          {loading && vehicles.length === 0 ? (
            <p className="desk-muted">{t('desk.calendar.loading')}</p>
          ) : vehicles.length === 0 ? (
            <p className="desk-muted">{t('desk.calendar.empty')}</p>
          ) : (
            <div className="fleet-cal-list">
              {vehicles.map((v) => (
                <div key={v.id} className="fleet-cal-row">
                  <div className="fleet-cal-vehicle">
                    {v.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="fleet-vehicle-thumb" src={v.coverImageUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="fleet-cal-vehicle-placeholder" aria-hidden />
                    )}
                    <div>
                      <div>
                        <code>{v.licensePlate}</code>
                      </div>
                      {v.modelLabel && <div className="desk-muted fleet-cal-model">{v.modelLabel}</div>}
                    </div>
                  </div>
                  <div className="fleet-cal-track">
                    {(byVehicleBlocks.get(v.id) ?? []).map((b) => {
                      const seg = clipSegment(
                        range.rangeStart,
                        range.rangeEnd,
                        new Date(b.startsAt),
                        new Date(b.endsAt),
                      );
                      if (!seg) return null;
                      const title =
                        [formatDeskCalendarBlockType(b.type, t), b.reason?.trim()].filter(Boolean).join(' · ') ||
                        formatDeskCalendarBlockType(b.type, t);
                      return (
                        <span
                          key={b.id}
                          className="fleet-cal-bar fleet-cal-block"
                          style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                          title={title}
                        />
                      );
                    })}
                    {(byVehicleRes.get(v.id) ?? []).map((r) => {
                      const seg = clipSegment(
                        range.rangeStart,
                        range.rangeEnd,
                        new Date(r.pickupAt),
                        new Date(r.returnAt),
                      );
                      if (!seg) return null;
                      const cust = r.customer?.name?.trim();
                      const statusLbl = formatDeskReservationStatus(r.status, t);
                      const title = [statusLbl, r.status, cust].filter(Boolean).join(' · ');
                      return (
                        <Link
                          key={r.id}
                          href={`/desk/reservations?companyId=${encodeURIComponent(companyId)}&open=${encodeURIComponent(r.id)}`}
                          className={`fleet-cal-bar ${reservationBarClass(r.status)}`}
                          style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                          title={`${title} · ${t('desk.calendar.openRes')}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
