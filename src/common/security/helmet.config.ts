import type { HelmetOptions } from 'helmet';

/**
 * Centralized helmet configuration for the WorkTime API.
 *
 * Philosophy:
 *  - This is a JSON API, not an HTML-serving app. CSP is therefore disabled
 *    here; the browser-facing CSP lives at the nginx + Next.js layer where
 *    HTML responses actually originate.
 *  - HSTS is only asserted in production. In dev/test the API may be served
 *    over plain HTTP on localhost, and emitting HSTS there pollutes browser
 *    state and breaks local TLS-free workflows.
 *  - Frame embedding is flatly denied — the API must never be rendered in an
 *    iframe under any origin.
 *  - Referrer-Policy is `strict-origin-when-cross-origin` so same-origin
 *    navigations keep their full Referer (useful for logging) while cross-
 *    origin ones only leak the bare origin.
 */
export const helmetConfig: HelmetOptions = {
  // CSP handled upstream (nginx / Next.js). See notes above.
  contentSecurityPolicy: false,

  // Only assert HSTS in production. Dev/staging-over-HTTP would be poisoned
  // by a stray HSTS header.
  hsts:
    process.env.NODE_ENV === 'production'
      ? {
          maxAge: 60 * 60 * 24 * 180, // 180 days
          includeSubDomains: true,
          preload: true,
        }
      : false,

  // Hard-deny framing of any API response.
  frameguard: {
    action: 'deny',
  },

  // X-Content-Type-Options: nosniff
  noSniff: true,

  // Legacy X-XSS-Protection: 0 (helmet default turns it off, which is the
  // modern recommendation; we keep xssFilter enabled so the header is
  // explicitly set rather than omitted).
  xssFilter: true,

  // Leak origin on cross-origin navigations, full URL on same-origin.
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
};
