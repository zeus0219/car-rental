'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppLogo } from './AppLogo';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { clearAccessToken } from '../lib/auth-storage';
import { useStaffSessionOptional } from '../lib/use-staff-session';

export function SiteHeader() {
  const { locale, setLocale, t } = usePublicLocaleContext();
  const router = useRouter();
  const { me, ready } = useStaffSessionOptional();

  return (
    <header className="site-header">
      <AppLogo href="/" variant="header" priority />
      <nav className="site-header-nav" aria-label="Main">
        <Link href="/quote">{t('nav.quote')}</Link>
        <Link href="/my">{t('nav.my')}</Link>
        {ready && me ? (
          <>
            <Link href="/desk">{t('nav.desk')}</Link>
            <Link href="/desk/account">{t('nav.accountHeader')}</Link>
            <button
              type="button"
              className="site-header-signout"
              onClick={() => {
                clearAccessToken();
                router.refresh();
              }}
            >
              {t('nav.signOutPublic')}
            </button>
          </>
        ) : (
          <Link href="/auth">{t('nav.staff')}</Link>
        )}
      </nav>
      <div className="site-header-locale" role="group" aria-label={t('locale.label')}>
        <button
          type="button"
          className={`site-header-locale-btn ${locale === 'en' ? 'is-active' : ''}`}
          aria-pressed={locale === 'en'}
          onClick={() => setLocale('en')}
        >
          {t('locale.en')}
        </button>
        <button
          type="button"
          className={`site-header-locale-btn ${locale === 'it' ? 'is-active' : ''}`}
          aria-pressed={locale === 'it'}
          onClick={() => setLocale('it')}
        >
          {t('locale.it')}
        </button>
      </div>
    </header>
  );
}
