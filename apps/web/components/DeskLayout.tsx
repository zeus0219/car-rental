'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getAccessToken } from '../lib/auth-storage';
import { DeskNav } from './DeskNav';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import './desk-layout.css';

export function DeskLayout({ children }: { children: ReactNode }) {
  const { t } = usePublicLocaleContext();
  const router = useRouter();
  const pathname = usePathname();
  const [gate, setGate] = useState<'check' | 'in' | 'out'>('check');

  useEffect(() => {
    if (getAccessToken()) setGate('in');
    else setGate('out');
  }, [pathname]);

  useEffect(() => {
    if (gate === 'out') {
      router.replace('/auth?next=' + encodeURIComponent(pathname ?? '/desk'));
    }
  }, [gate, router, pathname]);

  if (gate === 'check' || gate === 'out') {
    return (
      <main className="desk-gate">
        <p>{t('desk.loadingGate')}</p>
      </main>
    );
  }

  return (
    <div className="desk">
      <DeskNav />
      <div className="desk-content">{children}</div>
    </div>
  );
}
