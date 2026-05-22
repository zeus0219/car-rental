'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { AppLogo } from './AppLogo';
import { clearAccessToken } from '../lib/auth-storage';
import { deskNavShowsAudit, deskNavShowsFleetAndCalendar, deskNavShowsTeam } from '../lib/desk-nav-access';
import type { PublicMessageKey } from '../lib/public-messages';
import { useMe } from '../lib/use-me';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import type { Me } from '../lib/me-types';

type NavDef = { href: string; key: PublicMessageKey; when?: (m: Me) => boolean };

const baseLinks: NavDef[] = [
  { href: '/desk', key: 'desk.nav.dashboard' },
  { href: '/desk/account', key: 'desk.nav.account' },
  { href: '/desk/organization', key: 'desk.nav.organization' },
  { href: '/desk/fleet', key: 'desk.nav.fleet', when: deskNavShowsFleetAndCalendar },
  { href: '/desk/calendar', key: 'desk.nav.calendar', when: deskNavShowsFleetAndCalendar },
  { href: '/desk/customers', key: 'desk.nav.customers' },
  { href: '/desk/reservations', key: 'desk.nav.reservations' },
  { href: '/desk/operations', key: 'desk.nav.operations' },
  { href: '/desk/reconciliation', key: 'desk.nav.reconciliation' },
  { href: '/desk/reports', key: 'desk.nav.reports' },
  { href: '/desk/invoices', key: 'desk.nav.invoices' },
  { href: '/desk/team', key: 'desk.nav.team', when: deskNavShowsTeam },
  { href: '/desk/audit', key: 'desk.nav.audit', when: deskNavShowsAudit },
];

export function DeskNav() {
  const { t } = usePublicLocaleContext();
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading } = useMe();

  const links = useMemo(() => {
    if (loading || !me) {
      return baseLinks;
    }
    return baseLinks.filter((x) => (x.when ? x.when(me) : true));
  }, [me, loading]);

  return (
    <nav className="desk-nav" aria-label={t('desk.nav.aria')}>
      <AppLogo href="/desk" variant="desk" />
      {links.map(({ href, key }) => {
        const active =
          href === '/desk'
            ? pathname === '/desk' || pathname === '/desk/'
            : pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
        return (
          <Link
            key={href}
            href={href}
            className={`desk-nav-link${active ? ' is-active' : ''}`}
          >
            {t(key as PublicMessageKey)}
          </Link>
        );
      })}
      <span className="desk-spacer" />
      <button
        type="button"
        className="desk-sign-out"
        onClick={() => {
          clearAccessToken();
          router.push('/auth');
        }}
      >
        {t('desk.signOut')}
      </button>
    </nav>
  );
}
