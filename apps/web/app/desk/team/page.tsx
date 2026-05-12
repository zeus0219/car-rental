'use client';

import Link from 'next/link';
import { createStaffUserSchema, userRoleValues } from '@car-rental/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeskChangePasswordCard } from '../../../components/DeskChangePasswordCard';
import { MfaSettingsPanel } from '../../../components/MfaSettingsPanel';
import { CompanyScopeSelect } from '../../../components/CompanyScopeSelect';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { apiJson } from '../../../lib/api';
import { translateDeskApiError } from '../../../lib/desk-api-error-i18n';
import { formatDeskUserRole } from '../../../lib/desk-user-role-label';
import type { PublicLocale } from '../../../lib/public-locale';
import { useCompanyScope } from '../../../lib/use-company-scope';
import { useMe } from '../../../lib/use-me';

type StaffRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  stationId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  homeStation: { id: string; name: string; code: string } | null;
};

type CreateStaffResult = StaffRow & { temporaryPassword?: string; inviteEmailSent?: boolean };

type StationOption = { id: string; name: string; code: string };

function makeFmtTimeLocale(locale: PublicLocale) {
  const loc = locale === 'it' ? 'it-IT' : 'en-GB';
  return (iso: string | null) => {
    if (!iso) {
      return '—';
    }
    try {
      return new Date(iso).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };
}

export default function TeamPage() {
  const { t, locale } = usePublicLocaleContext();
  const fmtTime = useMemo(() => makeFmtTimeLocale(locale), [locale]);
  const { me, loading: meLoading, error: meErr } = useMe();
  const { companies, companyId, setCompanyId, ready, err: scopeErr } = useCompanyScope(me);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [draft, setDraft] = useState<{
    id: string;
    role: (typeof userRoleValues)[number];
    stationId: string;
    isActive: boolean;
  } | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'AGENT' as (typeof userRoleValues)[number],
    stationId: '',
    sendInviteEmail: false,
  });
  const [lastTempPassword, setLastTempPassword] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState<string | null>(null);
  const [setupEmailResentTo, setSetupEmailResentTo] = useState<string | null>(null);
  const [setupEmailResendErr, setSetupEmailResendErr] = useState<string | null>(null);
  const [setupEmailBusyId, setSetupEmailBusyId] = useState<string | null>(null);

  const isAdmin = me?.role === 'ADMIN';

  const load = useCallback(async () => {
    if (!companyId) {
      return;
    }
    setLoading(true);
    try {
      const list = await apiJson<StaffRow[]>(`/staff?companyId=${encodeURIComponent(companyId)}`);
      setRows(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => {
    if (!ready || !companyId) {
      return;
    }
    void load();
  }, [ready, companyId, load]);

  useEffect(() => {
    if (!isAdmin || !companyId) {
      setStations([]);
      return;
    }
    let c = false;
    (async () => {
      try {
        const st = await apiJson<StationOption[]>(
          `/stations?companyId=${encodeURIComponent(companyId)}`,
        );
        if (!c) {
          setStations(st);
        }
      } catch {
        if (!c) {
          setStations([]);
        }
      }
    })();
    return () => {
      c = true;
    };
  }, [isAdmin, companyId, ready]);

  function startEdit(r: StaffRow) {
    setSaveErr(null);
    setDraft({
      id: r.id,
      role: r.role as (typeof userRoleValues)[number],
      stationId: r.stationId ?? '',
      isActive: r.isActive,
    });
  }

  async function submitAddUser() {
    if (!companyId) {
      return;
    }
    setAddErr(null);
    setLastTempPassword(null);
    setLastInviteEmail(null);
    const body: {
      companyId: string;
      email: string;
      firstName: string;
      lastName: string;
      role: (typeof userRoleValues)[number];
      stationId: string | null;
      password?: string;
      sendInviteEmail?: boolean;
    } = {
      companyId,
      email: addForm.email.trim(),
      firstName: addForm.firstName.trim(),
      lastName: addForm.lastName.trim(),
      role: addForm.role,
      stationId: addForm.stationId === '' ? null : addForm.stationId,
    };
    const trimmedPw = addForm.password.trim();
    if (trimmedPw) {
      body.password = trimmedPw;
    }
    if (addForm.sendInviteEmail && !trimmedPw) {
      body.sendInviteEmail = true;
    }
    const parsed = createStaffUserSchema.safeParse(body);
    if (!parsed.success) {
      setAddErr(translateDeskApiError(JSON.stringify({ message: parsed.error.flatten() })));
      return;
    }
    setAdding(true);
    try {
      const created = await apiJson<CreateStaffResult>('/staff', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      const { temporaryPassword, inviteEmailSent, ...row } = created;
      setRows((prev) =>
        [...prev, row].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.email.localeCompare(b.email)),
      );
      if (inviteEmailSent) {
        setLastInviteEmail(row.email);
      } else if (typeof temporaryPassword === 'string' && temporaryPassword) {
        setLastTempPassword(temporaryPassword);
      }
      setAddForm({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: 'AGENT',
        stationId: '',
        sendInviteEmail: false,
      });
      setAddOpen(false);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAdding(false);
    }
  }

  async function resendSetupEmail(r: StaffRow) {
    setSetupEmailResendErr(null);
    setSetupEmailResentTo(null);
    setLastInviteEmail(null);
    setSetupEmailBusyId(r.id);
    try {
      await apiJson<{ ok: true }>(`/staff/${encodeURIComponent(r.id)}/send-setup-email`, {
        method: 'POST',
      });
      setSetupEmailResentTo(r.email);
    } catch (e) {
      setSetupEmailResendErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setSetupEmailBusyId(null);
    }
  }

  async function saveEdit() {
    if (!draft) {
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const body: {
        role: (typeof userRoleValues)[number];
        isActive: boolean;
        stationId: string | null;
      } = {
        role: draft.role,
        isActive: draft.isActive,
        stationId: draft.stationId === '' ? null : draft.stationId,
      };
      const updated = await apiJson<StaffRow>(`/staff/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setRows((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setDraft(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) {
    return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  }
  if (meErr) {
    return <p className="desk-err">{meErr}</p>;
  }
  if (!me) {
    return null;
  }
  if (scopeErr) {
    return <p className="desk-err">{scopeErr}</p>;
  }
  if (!ready) {
    return <p className="desk-muted">{t('desk.loadingGate')}</p>;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.nav.team')}</h1>
      <p className="desk-muted" style={{ marginTop: 0 }}>
        {t('desk.team.intro.line1')}{' '}
        <strong>{t('desk.team.intro.adminStrong')}</strong>
        {t('desk.team.intro.afterAdmin')}
        <strong>{t('desk.team.intro.oneTimeStrong')}</strong>
        {t('desk.team.intro.afterOneTime')}
        <Link href="/desk/account">{t('desk.nav.account')}</Link>
        {t('desk.team.intro.afterAccount')}
        <Link href="/auth/forgot">{t('desk.team.forgotPasswordLink')}</Link>
        {t('desk.team.intro.afterForgot')}
      </p>
      {isAdmin && (
        <p className="desk-muted" style={{ marginTop: 0, maxWidth: '40rem', fontSize: '0.95rem' }}>
          {t('desk.team.intro.resendSetup')}
        </p>
      )}
      <p className="desk-muted" style={{ fontSize: '0.85rem', maxWidth: '40rem' }}>
        {t('desk.team.passwordPolicyPrefix')}
        {t('auth.reset.passwordPolicyHint')}
      </p>
      {lastTempPassword && (
        <p className="desk-err" role="status" style={{ maxWidth: '40rem' }}>
          {t('desk.team.tempPassword')}{' '}
          <code style={{ userSelect: 'all' }}>{lastTempPassword}</code>
        </p>
      )}
      {lastInviteEmail && (
        <p className="desk-muted" role="status" style={{ maxWidth: '40rem' }}>
          {t('desk.team.inviteSent').replace('{email}', lastInviteEmail)}
        </p>
      )}
      {setupEmailResentTo && (
        <p className="desk-muted" role="status" style={{ maxWidth: '40rem' }}>
          {t('desk.team.setupEmailResent').replace('{email}', setupEmailResentTo)}
        </p>
      )}
      {setupEmailResendErr && (
        <p className="desk-err" role="status" style={{ maxWidth: '40rem' }}>
          {setupEmailResendErr}
        </p>
      )}
      <div style={{ marginTop: '0.75rem' }}>
        <DeskChangePasswordCard showForgotLink={false} />
      </div>
      <MfaSettingsPanel
        me={me}
        onMfaChange={() => {
          window.location.reload();
        }}
      />
      {isAdmin && companyId && (
        <div className="desk-tool" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            onClick={() => {
              setAddOpen((o) => {
                const next = !o;
                if (next) {
                  setLastTempPassword(null);
                  setLastInviteEmail(null);
                  setSetupEmailResentTo(null);
                  setSetupEmailResendErr(null);
                  setAddErr(null);
                }
                return next;
              });
            }}
          >
            {addOpen ? t('desk.team.addUserCancel') : t('desk.team.addUserOpen')}
          </button>
        </div>
      )}
      {addOpen && isAdmin && companyId && (
        <div className="desk-form-panel" style={{ marginTop: '0.75rem', maxWidth: '28rem' }}>
          <p style={{ marginTop: 0, fontSize: '0.95rem' }}>{t('desk.team.addPanelTitle')}</p>
          {addErr && <p className="desk-err">{addErr}</p>}
          <div className="desk-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <label>
              {t('desk.team.field.email')}
              <input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                autoComplete="off"
                required
                maxLength={320}
              />
            </label>
            <label>
              {t('desk.team.field.initialPassword')}
              <input
                type="password"
                value={addForm.password}
                onChange={(e) => {
                  const v = e.target.value;
                  setAddForm((f) => ({
                    ...f,
                    password: v,
                    sendInviteEmail: v.trim() ? false : f.sendInviteEmail,
                  }));
                }}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={addForm.sendInviteEmail}
                disabled={addForm.password.trim().length > 0}
                onChange={(e) => setAddForm((f) => ({ ...f, sendInviteEmail: e.target.checked }))}
              />
              <span style={{ flex: 1 }}>
                {t('desk.team.inviteEmail')}
                <span className="desk-muted" style={{ display: 'block', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  {t('desk.team.inviteEmailHint')}
                </span>
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <label>
                {t('desk.team.field.firstName')}
                <input
                  value={addForm.firstName}
                  onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                {t('desk.team.field.lastName')}
                <input
                  value={addForm.lastName}
                  onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                  maxLength={100}
                />
              </label>
            </div>
            <label>
              {t('desk.team.field.role')}
              <select
                value={addForm.role}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    role: e.target.value as (typeof userRoleValues)[number],
                  }))
                }
              >
                {userRoleValues.map((role) => (
                  <option key={role} value={role}>
                    {formatDeskUserRole(role, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('desk.team.field.homeStation')}
              <select
                value={addForm.stationId}
                onChange={(e) => setAddForm((f) => ({ ...f, stationId: e.target.value }))}
              >
                <option value="">{t('desk.team.stationNone')}</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </label>
            <div className="desk-form-actions" style={{ marginTop: 0 }}>
              <button type="button" onClick={submitAddUser} disabled={adding}>
                {adding ? t('desk.team.creating') : t('desk.team.createUser')}
              </button>
            </div>
          </div>
        </div>
      )}
      <CompanyScopeSelect
        me={me}
        companies={companies}
        companyId={companyId}
        onChange={setCompanyId}
      />
      {err && <p className="desk-err">{err}</p>}
      {saveErr && <p className="desk-err">{saveErr}</p>}
      {draft && isAdmin && (
        <div
          className="desk-form-panel"
          style={{ marginTop: '1rem', maxWidth: '28rem' }}
        >
          <p style={{ marginTop: 0, fontSize: '0.95rem' }}>
            {t('desk.team.editUser')} <code>{draft.id}</code>
          </p>
          <div className="desk-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label>
              {t('desk.team.field.role')}
              <select
                value={draft.role}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          role: e.target.value as (typeof userRoleValues)[number],
                        }
                      : d,
                  )
                }
                disabled={draft.id === me.id}
              >
                {userRoleValues.map((role) => (
                  <option key={role} value={role}>
                    {formatDeskUserRole(role, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('desk.team.field.homeStationEdit')}
              <select
                value={draft.stationId}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, stationId: e.target.value } : d))
                }
              >
                <option value="">{t('desk.team.stationNone')}</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, isActive: e.target.checked } : d))
                }
                disabled={draft.id === me.id}
              />
              {t('desk.team.active')}
            </label>
            <div className="desk-form-actions" style={{ marginTop: 0 }}>
              <button type="button" onClick={saveEdit} disabled={saving}>
                {saving ? t('desk.team.saving') : t('desk.team.save')}
              </button>
              <button type="button" onClick={() => setDraft(null)} disabled={saving}>
                {t('desk.team.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {loading && <p className="desk-muted">{t('desk.loadingGate')}</p>}
      {!loading && !err && companyId && (
        <div className="desk-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="desk-table">
            <thead>
              <tr>
                <th>{t('desk.team.th.name')}</th>
                <th>{t('desk.team.th.email')}</th>
                <th>{t('desk.team.th.role')}</th>
                <th>{t('desk.team.th.station')}</th>
                <th>{t('desk.team.th.active')}</th>
                <th>{t('desk.team.th.lastLogin')}</th>
                {isAdmin && <th>{t('desk.team.th.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.firstName} {r.lastName}
                  </td>
                  <td>{r.email}</td>
                  <td>
                    <code title={r.role}>{formatDeskUserRole(r.role, t)}</code>
                  </td>
                  <td>
                    {r.homeStation
                      ? `${r.homeStation.name} (${r.homeStation.code})`
                      : t('desk.fleet.quote.emDash')}
                  </td>
                  <td>{r.isActive ? t('desk.team.activeYes') : t('desk.team.activeNo')}</td>
                  <td>{fmtTime(r.lastLoginAt)}</td>
                  {isAdmin && (
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                        <button type="button" onClick={() => startEdit(r)}>
                          {t('desk.fleet.action.edit')}
                        </button>
                        {r.isActive && !r.lastLoginAt && r.id !== me.id && (
                          <button
                            type="button"
                            title={t('desk.team.sendSetupEmailAgainTitle')}
                            disabled={setupEmailBusyId === r.id}
                            onClick={() => void resendSetupEmail(r)}
                          >
                            {setupEmailBusyId === r.id
                              ? t('desk.team.sendSetupEmailBusy')
                              : t('desk.team.sendSetupEmailAgain')}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="desk-muted">{t('desk.team.empty')}</p>}
        </div>
      )}
    </div>
  );
}
