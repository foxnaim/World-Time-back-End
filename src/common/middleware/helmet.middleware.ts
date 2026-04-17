import helmet from 'helmet';

/**
 * Helmet configuration for the WorkTime API.
 *
 * Notes:
 *  - CSP is disabled because this is a JSON API (no HTML responses to protect
 *    with a Content-Security-Policy). The frontend sets its own CSP.
 *  - HSTS: 180 days, include subdomains, preload-ready.
 *  - Referrer-Policy: no-referrer so request URLs never leak to third parties.
 *  - Cross-Origin-Resource-Policy: same-site keeps API responses from being
 *    embedded by unrelated origins.
 *  - Frameguard: deny so no origin can embed API responses in a frame.
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  hsts: {
    maxAge: 60 * 60 * 24 * 180, // 180 days
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'no-referrer',
  },
  crossOriginResourcePolicy: {
    policy: 'same-site',
  },
  frameguard: {
    action: 'deny',
  },
});
