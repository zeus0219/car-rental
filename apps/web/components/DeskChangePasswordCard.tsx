'use client';

import Link from 'next/link';
import { useState } from 'react';
import { changePasswordSchema } from '@car-rental/shared';
import { apiJson } from '../lib/api';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { usePublicLocaleContext } from './PublicLocaleProvider';

type Props = {
  /** When false, omit the link to `/auth/forgot` (e.g. Team page already explains it above). */
  showForgotLink?: boolean;
};

export function DeskChangePasswordCard({ showForgotLink = true }: Props) {
  const { t } = usePublicLocaleContext();
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwOk, setPwOk] = useState(false);

  async function submitChangePassword() {
    setPwErr(null);
    if (pwNew !== pwNew2) {
      setPwErr(t('desk.password.err.mismatch'));
      return;
    }
    const p = changePasswordSchema.safeParse({
      currentPassword: pwCurrent,
      newPassword: pwNew,
    });
    if (!p.success) {
      setPwErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
      return;
    }
    setPwSaving(true);
    try {
      await apiJson('/auth/password', { method: 'POST', body: JSON.stringify(p.data) });
      setPwCurrent('');
      setPwNew('');
      setPwNew2('');
      setPwErr(null);
      setPwOk(true);
      window.setTimeout(() => setPwOk(false), 5000);
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="desk-form-panel" style={{ maxWidth: '24rem' }}>
      <p style={{ marginTop: 0, fontSize: '0.95rem', fontWeight: 600 }}>{t('desk.password.cardTitle')}</p>
      <p className="desk-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        {t('desk.password.policyLabel')} {t('auth.reset.passwordPolicyHint')}
      </p>
      {pwOk && (
        <p className="desk-ok" role="status">
          {t('desk.password.updated')}
        </p>
      )}
      {pwErr && <p className="desk-err">{pwErr}</p>}
      <div className="desk-form" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label>
          {t('desk.password.current')}
          <input
            type="password"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          {t('desk.password.new')}
          <input
            type="password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          {t('desk.password.confirm')}
          <input
            type="password"
            value={pwNew2}
            onChange={(e) => setPwNew2(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <div className="desk-form-actions" style={{ marginTop: 0 }}>
          <button type="button" onClick={() => void submitChangePassword()} disabled={pwSaving}>
            {pwSaving ? t('desk.password.saving') : t('desk.password.update')}
          </button>
        </div>
        {showForgotLink && (
          <p className="desk-muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            <Link href="/auth/forgot">{t('auth.forgotLink')}</Link> {t('desk.password.forgotSuffix')}
          </p>
        )}
      </div>
    </div>
  );
}
