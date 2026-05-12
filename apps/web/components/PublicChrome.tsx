'use client';

import type { ReactNode } from 'react';
import type { PublicLocale } from '../lib/public-locale';
import { PublicLocaleProvider } from './PublicLocaleProvider';
import { SiteHeader } from './SiteHeader';

export function PublicChrome({
  initialLocale,
  children,
}: {
  initialLocale: PublicLocale;
  children: ReactNode;
}) {
  return (
    <PublicLocaleProvider initialLocale={initialLocale}>
      <SiteHeader />
      {children}
    </PublicLocaleProvider>
  );
}
