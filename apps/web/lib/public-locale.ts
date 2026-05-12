/** H3: public web locale (cookie; no desk coverage in v1 slice). */

export const PUBLIC_LOCALE_COOKIE = 'carrental_public_locale';

export type PublicLocale = 'en' | 'it';

export function parsePublicLocale(value: string | undefined): PublicLocale {
  const v = value?.trim().toLowerCase();
  return v === 'it' ? 'it' : 'en';
}

/** Read locale from `document.cookie` (client only). Defaults to EN during SSR. */
export function tryParseLocaleCookie(): PublicLocale {
  if (typeof document === 'undefined') {
    return 'en';
  }
  const raw = document.cookie.split(';').map((s) => s.trim());
  for (const row of raw) {
    if (row.startsWith(`${PUBLIC_LOCALE_COOKIE}=`)) {
      return parsePublicLocale(row.slice(PUBLIC_LOCALE_COOKIE.length + 1));
    }
  }
  return 'en';
}
