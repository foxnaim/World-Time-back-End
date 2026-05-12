import { createRequire } from 'node:module';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const require = createRequire(import.meta.url);

const isProd = process.env.NODE_ENV === 'production';

// Use the Redis-backed cache handler only in production builds *and* only
// when REDIS_URL is available. In dev we stay on Next's file cache so a
// missing local Redis doesn't break hot reload.
const useRedisCache = isProd && Boolean(process.env.REDIS_URL);

// Backend origin for CSP's connect-src. Fall back to 'self' if the public
// API URL is unset (typical for dev where API is same-origin behind nginx).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

// Dev needs 'unsafe-eval' for React Refresh + webpack hot-reload, and ws:
// origins for HMR sockets. Prod strips both.
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline' https://telegram.org"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org";

const connectSrc = isProd
  ? `connect-src 'self'${apiUrl ? ` ${apiUrl}` : ''}`
  : `connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*${apiUrl ? ` ${apiUrl}` : ''}`;

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://t.me https://*.telegram.org https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
  "font-src 'self' data: https://fonts.gstatic.com",
  connectSrc,
  isProd
    ? 'frame-src https://oauth.telegram.org'
    : "frame-src 'self' https://oauth.telegram.org",
].join('; ');

// HSTS only in production. Dev is typically plain HTTP on localhost and
// emitting HSTS there poisons browser state across unrelated projects.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self)',
  },
  { key: 'Content-Security-Policy', value: csp },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=15552000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@tact/ui', '@tact/types'],
  // Expose server-only secrets to middleware (edge runtime) without the
  // `NEXT_PUBLIC_` prefix — so the value is NOT shipped to the browser.
  env: {
    JWT_PUBLIC_SECRET: process.env.JWT_PUBLIC_SECRET ?? '',
  },
  ...(useRedisCache
    ? {
        cacheHandler: require.resolve('./cache-handler.mjs'),
        // Disable the in-memory LRU Next ships with — our handler has its
        // own L1 and we don't want two LRUs fighting for RAM.
        cacheMaxMemorySize: 0,
      }
    : {}),
  experimental: {
    optimizePackageImports: ['framer-motion'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 't.me',
      },
      {
        protocol: 'https',
        hostname: 'telegram.org',
      },
      {
        protocol: 'https',
        hostname: 'cdn.telegram.org',
      },
      {
        protocol: 'https',
        hostname: '**.telegram-cdn.org',
      },
      {
        protocol: 'https',
        hostname: '**.t.me',
      },
    ],
  },
  // In dev, Next.js runs on :3000 while the backend is on :4000. Relative
  // /api/* calls from client components (e.g. QR display SSE/polling) would
  // hit Next.js and get 404. Rewrites proxy them to the real backend so the
  // same URLs work in dev and behind nginx in production.
  async rewrites() {
    if (isProd) return [];
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
    const backendOrigin = apiBase.replace(/\/api\/?$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // Applies to every route. Nginx may also set a subset of these in
        // front of us; duplicates are harmless but keep the two layers in
        // sync when you tweak CSP.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

const sentryEnabled = Boolean(process.env.SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: !process.env.SENTRY_DSN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
    })
  : nextConfig;
