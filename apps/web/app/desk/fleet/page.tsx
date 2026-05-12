'use client';

import { useCallback, useEffect, useState } from 'react';
import { canWriteVehicleClasses, VehicleClassForm } from '../../../components/VehicleClassForm';
import { canWriteVehicles, VehicleForm } from '../../../components/VehicleForm';
import { RateQuotePanel } from '../../../components/RateQuotePanel';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { formatDeskVehicleStatus } from '../../../lib/desk-fleet-vehicle-labels';
import type { PublicMessageKey } from '../../../lib/public-messages';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type VClass = {
  id: string;
  name: string;
  code: string;
  defaultDailyCents: number | null;
  defaultDepositCents: number | null;
};

type Vehicle = {
  id: string;
  licensePlate: string;
  modelLabel: string | null;
  coverImageUrl: string | null;
  odometerKm?: number;
  nextServiceDueOdometerKm?: number | null;
  autoServiceBlockHours?: number | null;
  status: string;
  vehicleType: string;
  rentPricingMode: string;
  rentOverrideDailyCents: number | null;
  flatTripRentCents: number | null;
  vehicleClass: { name: string; code: string };
  homeStation: { name: string; code: string };
};

function vehicleServiceReminderLabel(
  odometerKm: number | undefined,
  nextDue: number | null | undefined,
  t: (k: PublicMessageKey) => string,
): string {
  if (nextDue == null) {
    return t('desk.fleet.vehicles.service.na');
  }
  const odo = typeof odometerKm === 'number' ? odometerKm : 0;
  if (odo >= nextDue) {
    return t('desk.fleet.vehicles.service.due');
  }
  if (odo >= nextDue - 1000) {
    return t('desk.fleet.vehicles.service.soon');
  }
  return t('desk.fleet.vehicles.service.ok');
}

function vehicleRentPricingSummary(
  v: Vehicle,
  t: (k: PublicMessageKey) => string,
  numberLocale: string,
): string {
  if (v.rentPricingMode === 'FIXED_DAILY' && v.rentOverrideDailyCents != null) {
    return t('desk.fleet.vehicles.pricingSummary.fixedDaily').replace(
      '{cents}',
      v.rentOverrideDailyCents.toLocaleString(numberLocale),
    );
  }
  if (v.rentPricingMode === 'FLAT_TRIP' && v.flatTripRentCents != null) {
    return t('desk.fleet.vehicles.pricingSummary.flatTrip').replace(
      '{cents}',
      v.flatTripRentCents.toLocaleString(numberLocale),
    );
  }
  return t('desk.fleet.vehicles.pricingSummary.class');
}

export default function FleetPage() {
  const { t, locale } = usePublicLocaleContext();
  const numberLocale = locale === 'it' ? 'it-IT' : 'en-GB';
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [classes, setClasses] = useState<VClass[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [classFormOpen, setClassFormOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  const canWriteVclass = me ? canWriteVehicleClasses(me) : false;
  const canWriteVehicle = me ? canWriteVehicles(me) : false;

  const loadFleet = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [cl, ve] = await Promise.all([
        apiJson<VClass[]>(`/vehicle-classes?companyId=${encodeURIComponent(companyId)}`),
        apiJson<Vehicle[]>(`/vehicles?companyId=${encodeURIComponent(companyId)}`),
      ]);
      setClasses(cl);
      setVehicles(ve);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void loadFleet();
  }, [ready, companyId, loadFleet]);

  function openCreateClass() {
    setVehicleFormOpen(false);
    setEditingVehicleId(null);
    setEditingClassId(null);
    setClassFormOpen(true);
  }

  function openEditClass(id: string) {
    setVehicleFormOpen(false);
    setEditingVehicleId(null);
    setEditingClassId(id);
    setClassFormOpen(true);
  }

  function closeClassForm() {
    setClassFormOpen(false);
    setEditingClassId(null);
  }

  function openCreateVehicle() {
    setClassFormOpen(false);
    setEditingClassId(null);
    setEditingVehicleId(null);
    setVehicleFormOpen(true);
  }

  function openEditVehicle(id: string) {
    setClassFormOpen(false);
    setEditingClassId(null);
    setEditingVehicleId(id);
    setVehicleFormOpen(true);
  }

  function closeVehicleForm() {
    setVehicleFormOpen(false);
    setEditingVehicleId(null);
  }

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return null;
  if (scopeErr) return <p className="desk-err">{scopeErr}</p>;
  if (!ready) return <p className="desk-muted">{t('desk.loadingGate')}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.nav.fleet')}</h1>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={setCompanyId}
      />
      {err && <p className="desk-err">{err}</p>}
      {loading && <p className="desk-muted">{t('desk.fleet.loadingData')}</p>}
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.fleet.section.classes')}</h2>
        {canWriteVclass && (
          <div className="desk-tool" style={{ marginTop: 0 }}>
            <button type="button" onClick={openCreateClass}>
              {t('desk.fleet.classes.new')}
            </button>
            {!classFormOpen && (
              <span className="desk-muted">{t('desk.fleet.classes.hint')}</span>
            )}
          </div>
        )}
        {companyId && (
          <VehicleClassForm
            me={me}
            companyId={companyId}
            open={classFormOpen}
            editingId={editingClassId}
            onClose={closeClassForm}
            onSaved={() => {
              void loadFleet();
            }}
          />
        )}
        {classes.length === 0 && !loading && (
          <p className="desk-muted">{t('desk.fleet.classes.empty')}</p>
        )}
        {classes.length > 0 && (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.fleet.classes.th.code')}</th>
                  <th>{t('desk.fleet.classes.th.name')}</th>
                  <th>{t('desk.fleet.classes.th.dailyCents')}</th>
                  <th>{t('desk.fleet.classes.th.depositCents')}</th>
                  {canWriteVclass && <th>{t('desk.fleet.classes.th.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {classes.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <code>{v.code}</code>
                    </td>
                    <td>{v.name}</td>
                    <td>{v.defaultDailyCents ?? t('desk.fleet.quote.emDash')}</td>
                    <td>{v.defaultDepositCents ?? t('desk.fleet.quote.emDash')}</td>
                    {canWriteVclass && (
                      <td>
                        <div className="desk-table-actions">
                          <button type="button" onClick={() => openEditClass(v.id)}>
                            {t('desk.fleet.action.edit')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.fleet.section.quote')}</h2>
        <p className="desk-muted" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
          {t('desk.fleet.quote.intro')}
        </p>
        <RateQuotePanel companyId={companyId} classes={classes} me={me} />
      </section>
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.fleet.section.vehicles')}</h2>
        {canWriteVehicle && (
          <div className="desk-tool" style={{ marginTop: 0 }}>
            <button type="button" onClick={openCreateVehicle}>
              {t('desk.fleet.vehicles.new')}
            </button>
            {!vehicleFormOpen && (
              <span className="desk-muted">{t('desk.fleet.vehicles.hint')}</span>
            )}
          </div>
        )}
        {companyId && (
          <VehicleForm
            me={me}
            companyId={companyId}
            open={vehicleFormOpen}
            editingId={editingVehicleId}
            onClose={closeVehicleForm}
            onSaved={() => {
              void loadFleet();
            }}
          />
        )}
        {vehicles.length === 0 && !loading && (
          <p className="desk-muted">{t('desk.fleet.vehicles.empty')}</p>
        )}
        {vehicles.length > 0 && (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.fleet.vehicles.th.photo')}</th>
                  <th>{t('desk.fleet.vehicles.th.plate')}</th>
                  <th>{t('desk.fleet.vehicles.th.model')}</th>
                  <th>{t('desk.fleet.vehicles.th.status')}</th>
                  <th title={t('desk.fleet.vehicles.odoTitle')}>{t('desk.fleet.vehicles.th.odo')}</th>
                  <th title={t('desk.fleet.vehicles.serviceTitle')}>{t('desk.fleet.vehicles.th.service')}</th>
                  <th>{t('desk.fleet.vehicles.th.class')}</th>
                  <th>{t('desk.fleet.vehicles.th.pricing')}</th>
                  <th>{t('desk.fleet.vehicles.th.station')}</th>
                  {canWriteVehicle && <th>{t('desk.fleet.vehicles.th.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>
                      {v.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="fleet-vehicle-thumb"
                          src={v.coverImageUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="desk-muted">—</span>
                      )}
                    </td>
                    <td>
                      <code>{v.licensePlate}</code>
                    </td>
                    <td>{v.modelLabel ?? t('desk.fleet.quote.emDash')}</td>
                    <td>{formatDeskVehicleStatus(v.status, t)}</td>
                    <td className="desk-muted">
                      {typeof v.odometerKm === 'number' ? (
                        <>
                          {v.odometerKm.toLocaleString(numberLocale)}{' '}
                          <span className="desk-muted">{t('desk.fleet.vehicles.kmUnit')}</span>
                        </>
                      ) : (
                        t('desk.fleet.quote.emDash')
                      )}
                    </td>
                    <td
                      className="desk-muted"
                      style={{ fontSize: '0.88rem', whiteSpace: 'normal' }}
                      title={
                        v.nextServiceDueOdometerKm != null
                          ? `${t('desk.fleet.vehicles.serviceAt')} ${v.nextServiceDueOdometerKm.toLocaleString(numberLocale)} ${t('desk.fleet.vehicles.kmUnit')}`
                          : undefined
                      }
                    >
                      <div>{vehicleServiceReminderLabel(v.odometerKm, v.nextServiceDueOdometerKm, t)}</div>
                      {v.autoServiceBlockHours != null && (
                        <div style={{ marginTop: '0.15rem' }}>
                          {t('desk.fleet.vehicles.autoBlockLine')}{' '}
                          <strong>{v.autoServiceBlockHours}</strong>
                          {t('desk.fleet.vehicles.hoursShort')}
                        </div>
                      )}
                    </td>
                    <td>
                      {v.vehicleClass.name} <span className="desk-muted">({v.vehicleClass.code})</span>
                    </td>
                    <td className="desk-muted" style={{ fontSize: '0.88rem' }}>
                      {vehicleRentPricingSummary(v, t, numberLocale)}
                    </td>
                    <td>
                      {v.homeStation.name}{' '}
                      <span className="desk-muted">
                        <code>{v.homeStation.code}</code>
                      </span>
                    </td>
                    {canWriteVehicle && (
                      <td>
                        <div className="desk-table-actions">
                          <button type="button" onClick={() => openEditVehicle(v.id)}>
                            {t('desk.fleet.action.edit')}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
