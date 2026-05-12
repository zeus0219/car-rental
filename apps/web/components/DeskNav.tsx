'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { clearAccessToken } from '../lib/auth-storage';
import type { PublicMessageKey } from '../lib/public-messages';
import { useMe } from '../lib/use-me';
import { usePublicLocaleContext } from './PublicLocaleProvider';

const baseLinks: { href: string; key: PublicMessageKey }[] = [
  { href: '/desk', key: 'desk.nav.dashboard' },
  { href: '/desk/account', key: 'desk.nav.account' },
  { href: '/desk/organization', key: 'desk.nav.organization' },
  { href: '/desk/fleet', key: 'desk.nav.fleet' },
  { href: '/desk/calendar', key: 'desk.nav.calendar' },
  { href: '/desk/customers', key: 'desk.nav.customers' },
  { href: '/desk/reservations', key: 'desk.nav.reservations' },
  { href: '/desk/reconciliation', key: 'desk.nav.reconciliation' },
  { href: '/desk/reports', key: 'desk.nav.reports' },
  { href: '/desk/invoices', key: 'desk.nav.invoices' },
  { href: '/desk/team', key: 'desk.nav.team' },
];

function canViewAuditNav(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'BRANCH_MANAGER' || role === 'READONLY_ACCOUNTING';
}

export function DeskNav() {
  const { t } = usePublicLocaleContext();
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();

  const links = useMemo(() => {
    if (me && canViewAuditNav(me.role)) {
      return [...baseLinks, { href: '/desk/audit', key: 'desk.nav.audit' }];
    }
    return baseLinks;
  }, [me]);

  return (
    <nav className="desk-nav" aria-label={t('desk.nav.aria')}>
      <span className="desk-brand">{t('desk.brand')}</span>
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
