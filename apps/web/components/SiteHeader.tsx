'use client';

import Link from 'next/link';
import { usePublicLocaleContext } from './PublicLocaleProvider';

export function SiteHeader() {
  const { locale, setLocale, t } = usePublicLocaleContext();

  return (
    <header className="site-header">
      <Link href="/" className="site-header-brand">
        {t('nav.brand')}
      </Link>
      <nav className="site-header-nav" aria-label="Main">
        <Link href="/quote">{t('nav.quote')}</Link>
        <Link href="/auth">{t('nav.staff')}</Link>
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
