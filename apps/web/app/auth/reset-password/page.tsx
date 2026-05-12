'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { strongPasswordSchema } from '@car-rental/shared';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { getApiBase } from '../../../lib/api';
import { translateDeskApiError } from '../../../lib/desk-api-error-i18n';

function ResetForm() {
  const { t, locale } = usePublicLocaleContext();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token')?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pwCheck = strongPasswordSchema.safeParse(password);
    if (!pwCheck.success) {
      const first =
        pwCheck.error.issues[0]?.message ?? t('auth.err.passwordPolicyGeneric');
      setError(locale === 'it' ? t('auth.err.passwordPolicyGeneric') : first);
      return;
    }
    if (password !== again) {
      setError(t('auth.err.passwordMismatch'));
      return;
    }
    if (!/^[a-f0-9]{64}$/i.test(tokenFromUrl)) {
      setError(t('auth.err.invalidResetToken'));
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenFromUrl.toLowerCase(), newPassword: pwCheck.data }),
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <h1>{t('auth.reset.doneTitle')}</h1>
        <p className="auth-sub" style={{ marginTop: '0.75rem' }}>
          {t('auth.reset.doneBody')}
        </p>
        <p style={{ marginTop: '1.5rem', marginBottom: 0 }}>
          <Link href="/auth">{t('auth.signIn')}</Link>
        </p>
      </>
    );
  }

  if (!tokenFromUrl) {
    return (
      <>
        <h1>{t('auth.reset.title')}</h1>
        <p className="desk-err" role="alert" style={{ marginTop: '1rem' }}>
          {t('auth.reset.missingTokenBefore')}{' '}
          <Link href="/auth/forgot">{t('auth.reset.requestNew')}</Link>.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="auth-sub" style={{ marginBottom: '1rem' }}>
        {t('auth.api')} <code>{getApiBase()}</code>
      </p>
      <h1>{t('auth.reset.setTitle')}</h1>
      <p className="auth-sub" style={{ marginTop: '0.35rem', maxWidth: '26rem' }}>
        {t('auth.reset.passwordPolicyHint')}
      </p>
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          {t('auth.reset.newPassword')}
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          {t('auth.reset.confirmPassword')}
          <input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading}>
          {loading ? t('auth.wait') : t('auth.reset.savePassword')}
        </button>
      </form>
      <p className="auth-footer" style={{ marginTop: '1.25rem' }}>
        <Link href="/auth">{t('auth.forgot.backSignIn')}</Link>
      </p>
    </>
  );
}

function ResetLoading() {
  const { t } = usePublicLocaleContext();
  return (
    <p className="desk-muted" style={{ margin: 0 }}>
      {t('booking.loading')}
    </p>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Suspense fallback={<ResetLoading />}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
