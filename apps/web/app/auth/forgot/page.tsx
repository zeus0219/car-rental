'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { getApiBase } from '../../../lib/api';
import { translateDeskApiError } from '../../../lib/desk-api-error-i18n';

export default function ForgotPasswordPage() {
  const { t } = usePublicLocaleContext();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/auth/password/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
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
      <main className="auth-page">
        <div className="auth-card">
          <h1>{t('auth.forgot.doneTitle')}</h1>
          <p className="auth-sub" style={{ marginTop: '0.75rem' }}>
            {t('auth.forgot.doneBody')}
          </p>
          <p style={{ marginTop: '1.5rem', marginBottom: 0 }}>
            <Link href="/auth">{t('auth.forgot.backSignIn')}</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>{t('auth.forgot.title')}</h1>
        <p className="auth-sub">
          {t('auth.forgot.blurb')} {t('auth.api')} <code>{getApiBase()}</code>
        </p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            {t('auth.email')}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading}>
            {loading ? t('auth.wait') : t('auth.forgot.sendLink')}
          </button>
        </form>
        <p className="auth-footer" style={{ marginTop: '1.25rem' }}>
          <Link href="/auth">{t('auth.forgot.backSignIn')}</Link>
          {' · '}
          <Link href="/">{t('booking.nav.home')}</Link>
        </p>
      </div>
    </main>
  );
}
