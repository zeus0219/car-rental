'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BRAND_LOGO_PATH, BRAND_NAME, BRAND_TAGLINE_IT } from '../lib/brand';

const VARIANTS = {
  header: { width: 200, height: 56, className: 'app-logo app-logo--header' },
  desk: { width: 176, height: 50, className: 'app-logo app-logo--desk' },
  auth: { width: 240, height: 68, className: 'app-logo app-logo--auth' },
} as const;

export type AppLogoVariant = keyof typeof VARIANTS;

type Props = {
  variant?: AppLogoVariant;
  href?: string;
  priority?: boolean;
  className?: string;
};

export function AppLogo({ variant = 'header', href, priority, className }: Props) {
  const { width, height, className: variantClass } = VARIANTS[variant];
  const alt = `${BRAND_NAME} — ${BRAND_TAGLINE_IT}`;
  const img = (
    <Image
      src={BRAND_LOGO_PATH}
      alt={alt}
      width={width}
      height={height}
      className={[variantClass, className].filter(Boolean).join(' ')}
      priority={priority}
      sizes={`(max-width: 640px) ${Math.round(width * 0.85)}px, ${width}px`}
    />
  );
  if (href) {
    return (
      <Link href={href} className="app-logo-link">
        {img}
      </Link>
    );
  }
  return img;
}
