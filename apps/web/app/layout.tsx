import { cookies } from 'next/headers';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { PublicChrome } from '../components/PublicChrome';
import { PUBLIC_LOCALE_COOKIE, parsePublicLocale } from '../lib/public-locale';
import './globals.css';

const sans = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-plus-jakarta',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#f0f2f7',
};

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = parsePublicLocale(cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value);
  if (locale === 'it') {
    return {
      title: 'FORESERVICE — Noleggio auto',
      description: 'Preventivo e prenotazioni — FORESERVICE noleggio auto',
      icons: { icon: '/foreservice-logo.png', apple: '/foreservice-logo.png' },
    };
  }
  return {
    title: 'FORESERVICE — Car rental',
    description: 'FORESERVICE car rental — quotes and bookings',
    icons: { icon: '/foreservice-logo.png', apple: '/foreservice-logo.png' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const locale = parsePublicLocale(cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} className={sans.variable}>
      <body className={sans.className}>
        <PublicChrome initialLocale={locale}>{children}</PublicChrome>
      </body>
    </html>
  );
}
