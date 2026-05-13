import { cookies } from 'next/headers';
import Link from 'next/link';
import { API_VERSION } from '@car-rental/shared';
import { PUBLIC_LOCALE_COOKIE, parsePublicLocale } from '../lib/public-locale';
import { publicT } from '../lib/public-messages';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

export default async function Home() {
  const cookieStore = await cookies();
  const locale = parsePublicLocale(cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value);
  const t = (key: Parameters<typeof publicT>[1]) => publicT(locale, key);

  return (
    <main className="page-home">
      <h1>{t('home.title')}</h1>
      <p className="page-home-lead">
        <Link href="/quote">{t('home.priceLink')}</Link> — {t('home.priceLine')}
      </p>
      <div className="page-home-actions">
        <Link href="/quote">{t('home.priceLink')}</Link>
        <Link href="/my">{t('nav.my')}</Link>
        <Link href="/auth">{t('nav.staff')}</Link>
      </div>
      <p>
        <strong>{t('home.staffStrong')}</strong>{' '}
        <Link href="/auth">{t('home.signIn')}</Link> {t('home.staffOrOpen')}{' '}
        <Link href="/desk">/{t('home.desk')}</Link> {t('home.staffSuffix')}
      </p>
      <p className="page-home-meta desk-muted">
        {t('home.apiLine')}: <code>API_VERSION</code> {API_VERSION} · <code>GET {apiBase}/health</code> ·{' '}
        <code>GET {apiBase}/health/ready</code>
      </p>
    </main>
  );
}
