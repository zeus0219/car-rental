'use client';

import { useCallback, useEffect, useState } from 'react';
import { CompanyCargosSettings } from '../../../components/CompanyCargosSettings';
import { CompanyFiscalSettings } from '../../../components/CompanyFiscalSettings';
import { CompanySdiSettings } from '../../../components/CompanySdiSettings';
import { CompanyOneWaySettings } from '../../../components/CompanyOneWaySettings';
import { CompanyPartnerApiKeysSettings } from '../../../components/CompanyPartnerApiKeysSettings';
import { CompanyPartnerWebhookDeliveries } from '../../../components/CompanyPartnerWebhookDeliveries';
import { CompanyPrivacyNoticeSettings } from '../../../components/CompanyPrivacyNoticeSettings';
import { canWriteStations, StationForm } from '../../../components/StationForm';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type Station = {
  id: string;
  name: string;
  code: string;
  city: string;
  province: string;
  companyId: string;
  addressLine?: string;
  postalCode?: string;
  country?: string;
  timeZone?: string;
};

export default function OrganizationPage() {
  const { t } = usePublicLocaleContext();
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [stLoading, setStLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadStations = useCallback(async () => {
    if (!companyId) return;
    setStLoading(true);
    try {
      const list = await apiJson<Station[]>(`/stations?companyId=${encodeURIComponent(companyId)}`);
      setStations(list);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setStLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    if (!ready || !companyId) return;
    void loadStations();
  }, [ready, companyId, loadStations]);

  const canWrite = me ? canWriteStations(me) : false;

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  if (meLoading) return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  if (meErr) return <p className="desk-err">{meErr}</p>;
  if (!me) return null;
  if (scopeErr) return <p className="desk-err">{scopeErr}</p>;
  if (!ready) return <p className="desk-muted">{t('desk.loadingCompanies')}</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.nav.organization')}</h1>
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={setCompanyId}
      />
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.organization.sectionCompany')}</h2>
        <p className="desk-muted">{t('desk.organization.companyHint')}</p>
        <p>
          {t('desk.organization.currentCompany')}{' '}
          <strong>{companies.find((c) => c.id === companyId)?.name ?? companyId}</strong>
        </p>
        <details
          className="desk-muted"
          style={{
            marginTop: '0.65rem',
            marginBottom: '0.35rem',
            fontSize: '0.82rem',
            maxWidth: '40rem',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.organization.b4Summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.organization.b4Lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.organization.b4Item1')}</li>
            <li>{t('desk.organization.b4Item2')}</li>
            <li>{t('desk.organization.b4Item3')}</li>
            <li>{t('desk.organization.b4Item4')}</li>
            <li>{t('desk.organization.b4Item5')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{
            marginTop: '0.35rem',
            marginBottom: '0.35rem',
            fontSize: '0.82rem',
            maxWidth: '40rem',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.organization.d1d2Summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.organization.d1d2Lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.organization.d1d2Item1')}</li>
            <li>{t('desk.organization.d1d2Item2')}</li>
            <li>{t('desk.organization.d1d2Item3')}</li>
            <li>{t('desk.organization.d1d2Item4')}</li>
            <li>{t('desk.organization.d1d2Item5')}</li>
            <li>{t('desk.organization.d1d2Item6')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{
            marginTop: '0.35rem',
            marginBottom: '0.35rem',
            fontSize: '0.82rem',
            maxWidth: '40rem',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.organization.d3d4Summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.organization.d3d4Lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.organization.d3d4Item1')}</li>
            <li>{t('desk.organization.d3d4Item2')}</li>
            <li>{t('desk.organization.d3d4Item3')}</li>
            <li>{t('desk.organization.d3d4Item4')}</li>
            <li>{t('desk.organization.d3d4Item5')}</li>
            <li>{t('desk.organization.d3d4Item6')}</li>
          </ul>
        </details>
        <details
          className="desk-muted"
          style={{
            marginTop: '0.35rem',
            marginBottom: '0.35rem',
            fontSize: '0.82rem',
            maxWidth: '40rem',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
            {t('desk.organization.g2g3Summary')}
          </summary>
          <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.organization.g2g3Lead')}</p>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
            <li>{t('desk.organization.g2g3Item1')}</li>
            <li>{t('desk.organization.g2g3Item2')}</li>
            <li>{t('desk.organization.g2g3Item3')}</li>
            <li>{t('desk.organization.g2g3Item4')}</li>
            <li>{t('desk.organization.g2g3Item5')}</li>
            <li>{t('desk.organization.g2g3Item6')}</li>
          </ul>
        </details>
        {me && <CompanyOneWaySettings me={me} companyId={companyId} />}
        {me && <CompanyPartnerApiKeysSettings me={me} companyId={companyId} />}
        {me && <CompanyPartnerWebhookDeliveries me={me} companyId={companyId} />}
        {me && <CompanyPrivacyNoticeSettings me={me} companyId={companyId} />}
        {me && <CompanyFiscalSettings me={me} companyId={companyId} />}
        {me && <CompanyCargosSettings me={me} companyId={companyId} />}
        {me && <CompanySdiSettings me={me} companyId={companyId} />}
      </section>
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.organization.sectionStations')}</h2>
        {canWrite && (
          <div className="desk-tool" style={{ marginTop: 0 }}>
            <button type="button" onClick={openCreate}>
              {t('desk.organization.newStation')}
            </button>
            {!formOpen && (
              <span className="desk-muted">{t('desk.organization.stationsApiHint')}</span>
            )}
          </div>
        )}
        <StationForm
          me={me}
          companyId={companyId}
          open={formOpen}
          editingId={editingId}
          onClose={closeForm}
          onSaved={() => {
            void loadStations();
          }}
        />
        {loadErr && <p className="desk-err">{loadErr}</p>}
        {stLoading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
        {!stLoading && stations.length === 0 && !loadErr && (
          <p className="desk-muted">
            {t('desk.organization.emptyStations')}{' '}
            {canWrite && t('desk.organization.useNewStation')}
          </p>
        )}
        {stations.length > 0 && (
          <div className="desk-table-wrap">
            <table className="desk-table">
              <thead>
                <tr>
                  <th>{t('desk.organization.th.code')}</th>
                  <th>{t('desk.organization.th.name')}</th>
                  <th>{t('desk.organization.th.city')}</th>
                  <th>{t('desk.organization.th.province')}</th>
                  <th>{t('desk.organization.th.id')}</th>
                  {canWrite && <th>{t('desk.organization.th.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <code>{s.code}</code>
                    </td>
                    <td>{s.name}</td>
                    <td>{s.city}</td>
                    <td>{s.province}</td>
                    <td>
                      <code>{s.id}</code>
                    </td>
                    {canWrite && (
                      <td>
                        <div className="desk-table-actions">
                          <button type="button" onClick={() => openEdit(s.id)}>
                            {t('desk.organization.action.edit')}
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
