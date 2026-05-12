'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { PUBLIC_LOCALE_COOKIE, type PublicLocale, tryParseLocaleCookie } from '../lib/public-locale';
import { publicT, type PublicMessageKey } from '../lib/public-messages';

type Ctx = {
  locale: PublicLocale;
  setLocale: (locale: PublicLocale) => void;
  t: (key: PublicMessageKey) => string;
};

const PublicLocaleContext = createContext<Ctx | null>(null);

export function PublicLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: PublicLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<PublicLocale>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  const setLocale = useCallback((next: PublicLocale) => {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${next}; path=/; max-age=${maxAge}; SameSite=Lax`;
    setLocaleState(next);
    router.refresh();
  }, [router]);

  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale,
      t: (key: PublicMessageKey) => publicT(locale, key),
    }),
    [locale, setLocale],
  );

  return <PublicLocaleContext.Provider value={value}>{children}</PublicLocaleContext.Provider>;
}

export function usePublicLocaleContext(): Ctx {
  const c = useContext(PublicLocaleContext);
  if (!c) {
    throw new Error('usePublicLocaleContext must be used within PublicLocaleProvider');
  }
  return c;
}

export { tryParseLocaleCookie };
