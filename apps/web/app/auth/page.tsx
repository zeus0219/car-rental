'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppLogo } from '../../components/AppLogo';
import { usePublicLocaleContext } from '../../components/PublicLocaleProvider';
import { getApiBase } from '../../lib/api';
import { translateDeskApiError } from '../../lib/desk-api-error-i18n';
import { getAccessToken, setAccessToken, clearAccessToken } from '../../lib/auth-storage';

type LoginSuccess = { accessToken: string };
type MfaStep = { mfaRequired: true; mfaToken: string };

export default function LoginPage() {
  const { t } = usePublicLocaleContext();
  const router = useRouter();
  const [next, setNext] = useState('/desk');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaKind, setMfaKind] = useState<'totp' | 'backup'>('totp');
  const [totp, setTotp] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrollMfa, setEnrollMfa] = useState(false);
  const [backupCodesFlash, setBackupCodesFlash] = useState<string[] | null>(null);

  useEffect(() => {
    setNext(new URLSearchParams(window.location.search).get('next') || '/desk');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tok = getAccessToken();
    if (!tok) {
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const r = await fetch(`${getApiBase()}/auth/me`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (cancelled || !r.ok) {
          return;
        }
        const me = await r.json() as { mfaSetupPending?: boolean };
        if (me.mfaSetupPending) {
          setEnrollMfa(true);
          return;
        }
        router.replace('/desk');
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setMfaToken(null);
    setTotp('');
    setBackupCode('');
    setMfaKind('totp');
    setEnrollMfa(false);
    setBackupCodesFlash(null);
    try {
      const r = await fetch(`${getApiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      const data = (await r.json()) as LoginSuccess &
        Partial<MfaStep> & { mfaRequired?: boolean; mfaSetupPending?: boolean };
      if (data.mfaSetupPending && data.accessToken) {
        setAccessToken(data.accessToken);
        setEnrollMfa(true);
        return;
      }
      if (data.mfaRequired && 'mfaToken' in data && data.mfaToken) {
        setMfaToken(data.mfaToken);
        return;
      }
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        router.push(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setLoading(true);
    try {
      const body =
        mfaKind === 'totp'
          ? { mfaToken, totp: totp.replace(/\D/g, '').slice(0, 6) }
          : { mfaToken, backupCode: backupCode.trim() };
      const r = await fetch(`${getApiBase()}/auth/mfa/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      const data = (await r.json()) as LoginSuccess;
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        router.push(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMfaEnroll(e: FormEvent) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      const code = totp.replace(/\D/g, '').slice(0, 6);
      const r = await fetch(`${getApiBase()}/auth/mfa/setup/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      const data = (await r.json()) as {
        accessToken?: string;
        backupCodes?: string[];
      };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
      }
      setEnrollMfa(false);
      setTotp('');
      if (data.backupCodes?.length) {
        setBackupCodesFlash(data.backupCodes);
      } else {
        router.push(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  async function onCancelMfaEnroll() {
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/auth/mfa/setup/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      clearAccessToken();
      setEnrollMfa(false);
      setTotp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card-brand">
          <AppLogo variant="auth" priority />
        </div>
        <h1>{t('auth.title')}</h1>
        <p className="auth-sub">
          {t('auth.api')} <code>{getApiBase()}</code>
        </p>

        {backupCodesFlash ? (
          <div className="auth-form">
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>{t('auth.mfaBackupSaveIntro')}</p>
            <pre
              style={{
                margin: '0 0 1rem',
                padding: '0.75rem',
                background: 'var(--auth-pre-bg, #f4f4f5)',
                borderRadius: 6,
                fontSize: '0.85rem',
                overflow: 'auto',
              }}
            >
              {backupCodesFlash.join('\n')}
            </pre>
            <button
              type="button"
              onClick={() => {
                setBackupCodesFlash(null);
                router.push(next);
              }}
            >
              {t('auth.continueToDesk')}
            </button>
          </div>
        ) : !mfaToken ? (
          enrollMfa ? (
            <form className="auth-form" onSubmit={onSubmitMfaEnroll}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>{t('auth.mfaEnrollIntro')}</p>
              <label>
                {t('auth.code')}
                <input
                  className="mfa-code-input"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  placeholder={t('auth.codePlaceholder')}
                />
              </label>
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
              <div className="auth-actions">
                <button type="submit" disabled={loading}>
                  {loading ? t('auth.wait') : t('auth.verify')}
                </button>
                <button type="button" className="btn-ghost" disabled={loading} onClick={() => void onCancelMfaEnroll()}>
                  {t('auth.mfaEnrollCancel')}
                </button>
              </div>
            </form>
          ) : (
          <form className="auth-form" onSubmit={onSubmitPassword}>
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
            <label>
              {t('auth.password')}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading}>
              {loading ? t('auth.wait') : t('auth.signIn')}
            </button>
            <p className="auth-footer" style={{ margin: 0 }}>
              <Link href="/auth/forgot">{t('auth.forgotLink')}</Link>
              {' · '}
              <Link href="/auth/register">{t('auth.register.linkFromSignIn')}</Link>
            </p>
          </form>
          )
        ) : (
          <form className="auth-form" onSubmit={onSubmitMfa}>
            <p style={{ margin: 0, fontSize: '0.95rem' }}>{t('auth.mfaIntro')}</p>
            <div className="auth-segment">
              <button
                type="button"
                className={mfaKind === 'totp' ? 'is-active' : ''}
                aria-current={mfaKind === 'totp'}
                onClick={() => {
                  setMfaKind('totp');
                  setError(null);
                }}
              >
                {t('auth.code')}
              </button>
              <button
                type="button"
                className={mfaKind === 'backup' ? 'is-active' : ''}
                aria-current={mfaKind === 'backup'}
                onClick={() => {
                  setMfaKind('backup');
                  setError(null);
                }}
              >
                {t('auth.recoveryCode')}
              </button>
            </div>
            {mfaKind === 'totp' ? (
              <label>
                {t('auth.code')}
                <input
                  className="mfa-code-input"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  placeholder={t('auth.codePlaceholder')}
                />
              </label>
            ) : (
              <label>
                {t('auth.recoveryCode')}
                <input
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  autoComplete="off"
                  required
                  placeholder={t('auth.recoveryPlaceholder')}
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <span className="auth-hint">{t('auth.recoveryHint')}</span>
              </label>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <div className="auth-actions">
              <button type="submit" disabled={loading}>
                {loading ? t('auth.wait') : t('auth.verify')}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setMfaToken(null);
                  setTotp('');
                  setBackupCode('');
                  setMfaKind('totp');
                  setError(null);
                }}
              >
                {t('auth.back')}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
