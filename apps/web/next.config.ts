import path from 'node:path';
import type { NextConfig } from 'next';

/** Monorepo root (build runs with cwd = `apps/web`). */
const monorepoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /** Docker / Node hosting: one self-contained `node` process + traced files. */
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@car-rental/shared'],
  async redirects() {
    return [
      { source: '/login', destination: '/auth', permanent: true },
      { source: '/login/forgot', destination: '/auth/forgot', permanent: true },
      { source: '/login/register', destination: '/auth/register', permanent: true },
      { source: '/login/reset-password', destination: '/auth/reset-password', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
