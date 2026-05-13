'use client';

import Link from 'next/link';
import { usePublicLocaleContext } from '../../components/PublicLocaleProvider';

export default function MyRentalsHubPage() {
  const { t } = usePublicLocaleContext();

  return (
    <main className="page-home" style={{ maxWidth: '40rem', margin: '0 auto', padding: '1.25rem 1rem 2rem' }}>
      <h1>{t('my.title')}</h1>
      <p className="page-home-lead" style={{ marginTop: '0.75rem' }}>
        {t('my.lead')}
      </p>
      <ul style={{ marginTop: '1.25rem', lineHeight: 1.65, paddingLeft: '1.2rem' }}>
        <li>
          <Link href="/quote">{t('my.linkQuote')}</Link>
        </li>
        <li>
          <Link href="/booking/view">{t('my.linkBooking')}</Link>
        </li>
        <li>
          <Link href="/auth">{t('my.linkStaff')}</Link>
        </li>
      </ul>
    </main>
  );
}
