'use client';

import Link from 'next/link';
import { DeskChangePasswordCard } from '../../../components/DeskChangePasswordCard';
import { MfaSettingsPanel } from '../../../components/MfaSettingsPanel';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { formatDeskUserRole } from '../../../lib/desk-user-role-label';
import { useMe } from '../../../lib/use-me';

export default function DeskAccountPage() {
  const { t } = usePublicLocaleContext();
  const { me, loading, error: err } = useMe();

  if (loading) {
    return <p className="desk-muted">{t('desk.loadingProfile')}</p>;
  }
  if (err) {
    return <p className="desk-err">{err}</p>;
  }
  if (!me) {
    return null;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{t('desk.account.title')}</h1>
      <p className="desk-muted" style={{ maxWidth: '40rem' }}>
        {t('desk.account.introPrefix')}{' '}
        <Link href="/desk/team">{t('desk.nav.team')}</Link> {t('desk.account.introMiddle')}{' '}
        <Link href="/desk/team">{t('desk.nav.team')}</Link>.
      </p>
      <section style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.account.profileHeading')}</h2>
        <p style={{ margin: 0 }}>
          {me.firstName} {me.lastName} — <strong>{me.email}</strong>
        </p>
        <p className="desk-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
          {t('desk.user.role')}{' '}
          <span title={me.role}>{formatDeskUserRole(me.role, t)}</span> · {t('desk.user.companyId')}{' '}
          <code>{me.companyId}</code>
        </p>
      </section>
      <section style={{ marginTop: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>{t('desk.account.passwordHeading')}</h2>
        <DeskChangePasswordCard />
      </section>
      <section style={{ marginTop: '1.25rem' }}>
        {me.mfaCanEnable ? (
          <>
            <MfaSettingsPanel
              me={me}
              onMfaChange={() => {
                window.location.reload();
              }}
            />
            <details
              className="desk-muted"
              style={{
                marginTop: '0.75rem',
                fontSize: '0.82rem',
                maxWidth: '40rem',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
                {t('desk.account.a3Summary')}
              </summary>
              <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.account.a3Lead')}</p>
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
                <li>{t('desk.account.a3Item1')}</li>
                <li>{t('desk.account.a3Item2')}</li>
                <li>{t('desk.account.a3Item3')}</li>
                <li>{t('desk.account.a3Item4')}</li>
                <li>{t('desk.account.a3Item5')}</li>
              </ul>
            </details>
          </>
        ) : (
          <p className="desk-muted" style={{ maxWidth: '40rem' }}>
            {t('desk.account.mfaDisabledBefore')}{' '}
            <strong>{t('desk.account.mfaRoleAdmin')}</strong> {t('desk.account.mfaDisabledMid')}{' '}
            <strong>{t('desk.account.mfaRoleBranch')}</strong> {t('desk.account.mfaDisabledAfter')}
          </p>
        )}
      </section>
    </div>
  );
}
