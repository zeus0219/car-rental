'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { registerSchema, type UserRole, userRoleValues } from '@car-rental/shared';
import { usePublicLocaleContext } from '../../../components/PublicLocaleProvider';
import { getApiBase } from '../../../lib/api';
import { translateDeskApiError } from '../../../lib/desk-api-error-i18n';
import { formatDeskUserRole } from '../../../lib/desk-user-role-label';
import { getAccessToken, setAccessToken } from '../../../lib/auth-storage';
import { fetchPublicJson } from '../../../lib/public-api';

const defCompany = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID?.trim() ?? '';

type Catalog = {
  company: { id: string; name: string };
  stations: { id: string; name: string; code: string }[];
};

export default function RegisterPage() {
  const { t } = usePublicLocaleContext();
  const router = useRouter();
  const [companyId, setCompanyId] = useState(defCompany);
  const [stations, setStations] = useState<Catalog['stations']>([]);
  const [stationId, setStationId] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [role, setRole] = useState<UserRole>('AGENT');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getAccessToken()) {
      router.replace('/desk');
    }
  }, [router]);

  const loadCatalog = useCallback(async () => {
    const cid = companyId.trim();
    setCatalogErr(null);
    if (!cid || !/^[0-9a-f-]{36}$/i.test(cid)) {
      setStations([]);
      setStationId('');
      setCatalogErr(t('quote.err.invalidCompanyUuid'));
      return;
    }
    setCatalogLoading(true);
    try {
      const c = await fetchPublicJson<Catalog>(`/public/catalog?companyId=${encodeURIComponent(cid)}`);
      setStations(c.stations);
      setStationId('');
    } catch {
      setStations([]);
      setStationId('');
      setCatalogErr(t('auth.register.catalogErr'));
    } finally {
      setCatalogLoading(false);
    }
  }, [companyId, t]);

  /** Prefetch stations when the web app ships a default company id (same as quote flow). */
  useEffect(() => {
    const cid = defCompany.trim();
    if (!cid || !/^[0-9a-f-]{36}$/i.test(cid)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setCatalogLoading(true);
      setCatalogErr(null);
      try {
        const c = await fetchPublicJson<Catalog>(`/public/catalog?companyId=${encodeURIComponent(cid)}`);
        if (!cancelled) {
          setStations(c.stations);
        }
      } catch {
        if (!cancelled) {
          setCatalogErr(t('auth.register.catalogErr'));
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordAgain) {
      setError(t('auth.err.passwordMismatch'));
      return;
    }
    const parsed = registerSchema.safeParse({
      email: email.trim(),
      password,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      companyId: companyId.trim(),
      stationId: stationId || undefined,
      role,
    });
    if (!parsed.success) {
      setError(translateDeskApiError(JSON.stringify({ message: parsed.error.flatten() })));
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!r.ok) {
        const errText = await r.text();
        setError(translateDeskApiError(errText || r.statusText));
        return;
      }
      const data = (await r.json()) as { accessToken: string };
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        router.push('/desk');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.err.network'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>{t('auth.register.title')}</h1>
        <p className="auth-sub">{t('auth.register.sub')}</p>
        <p className="auth-sub" style={{ marginTop: '-0.5rem' }}>
          {t('auth.api')} <code>{getApiBase()}</code>
        </p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            {t('auth.register.companyId')}
            <input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              autoComplete="off"
              placeholder={t('form.placeholder.uuid')}
              spellCheck={false}
            />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" className="btn-ghost" onClick={() => void loadCatalog()} disabled={catalogLoading}>
              {catalogLoading ? t('auth.register.loadingCatalog') : t('auth.register.loadCatalog')}
            </button>
            <span className="auth-hint" style={{ flex: '1 1 12rem' }}>
              {t('auth.register.companyHint')}
            </span>
          </div>
          {catalogErr && (
            <p className="auth-error" role="status">
              {catalogErr}
            </p>
          )}

          <label>
            {t('auth.register.station')}
            <select value={stationId} onChange={(e) => setStationId(e.target.value)} disabled={!stations.length}>
              <option value="">{t('auth.register.stationNone')}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('auth.register.role')}
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {userRoleValues.map((rv) => (
                <option key={rv} value={rv}>
                  {formatDeskUserRole(rv, t)}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('auth.register.firstName')}
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required
            />
          </label>
          <label>
            {t('auth.register.lastName')}
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required
            />
          </label>
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
            />
          </label>
          <label>
            {t('auth.register.confirmPassword')}
            <input
              type="password"
              value={passwordAgain}
              onChange={(e) => setPasswordAgain(e.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
            />
          </label>
          <p className="auth-hint" style={{ margin: 0 }}>
            {t('auth.reset.passwordPolicyHint')}
          </p>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? t('auth.wait') : t('auth.register.submit')}
          </button>
        </form>

        <p className="auth-footer">
          {t('auth.register.haveAccount')} <Link href="/auth">{t('auth.signIn')}</Link>
        </p>
      </div>
    </main>
  );
}
