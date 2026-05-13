'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePublicLocaleContext } from '../components/PublicLocaleProvider';
import { clearAccessToken } from '../lib/auth-storage';
import { useStaffSessionOptional } from '../lib/use-staff-session';

export function PublicHomeActions() {
  const { t } = usePublicLocaleContext();
  const router = useRouter();
  const { me, ready } = useStaffSessionOptional();

  return (
    <div className="page-home-actions">
      <Link href="/quote" className="page-home-action page-home-action--primary">
        {t('home.priceLink')}
      </Link>
      <Link href="/my" className="page-home-action page-home-action--outline">
        {t('nav.my')}
      </Link>
      {ready && me ? (
        <>
          <Link href="/desk" className="page-home-action page-home-action--outline">
            {t('nav.desk')}
          </Link>
          <Link href="/desk/account" className="page-home-action page-home-action--outline">
            {t('nav.accountHeader')}
          </Link>
          <button
            type="button"
            className="page-home-action page-home-action--ghost"
            onClick={() => {
              clearAccessToken();
              router.refresh();
            }}
          >
            {t('nav.signOutPublic')}
          </button>
        </>
      ) : (
        <Link href="/auth" className="page-home-action page-home-action--outline">
          {t('nav.staff')}
        </Link>
      )}
    </div>
  );
}
