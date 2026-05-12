/* Tact — minimal service worker
 *
 * Scope:
 *   - cache-first for static assets (css / js / svg / woff2 / png / ico)
 *   - network-first for /api/* (with no caching of responses)
 *   - bypass entirely for Server-Sent Events endpoints (/stream, /api/*\/stream)
 *
 * Next.js 15 does not ship a first-party SW pipeline; this file is a plain,
 * dependency-free worker registered by <RegisterSw /> on the office QR page.
 */

const VERSION = 'tact-sw-v2';
const STATIC_CACHE = `${VERSION}-static`;
const EXPECTED_CACHE_PREFIX = 'tact-sw-';

const STATIC_EXTENSIONS = /\.(?:css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?)$/i;

self.addEventListener('install', (event) => {
  // Activate the new worker immediately — the office terminal is long-lived
  // and we want fixes to land without a manual reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Drop any previous-generation caches — both the prior `worktime-sw-*`
      // generation (pre-rebrand) and any older `tact-sw-*` versions that are
      // not the currently active VERSION.
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith(EXPECTED_CACHE_PREFIX) || k.startsWith('worktime-sw-')) &&
              !k.startsWith(VERSION),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Return true for SSE / long-lived streaming endpoints we must never
 * intercept — the worker would otherwise buffer the response and break
 * incremental delivery.
 */
function isStream(url, request) {
  if (url.pathname.endsWith('/stream') || url.pathname.includes('/stream/')) {
    return true;
  }
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/event-stream');
}

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname.startsWith('/icons/')) return true;
  return STATIC_EXTENSIONS.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET from same origin; everything else falls through to the
  // network (POST /api/events etc. must never be cached or retried).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch SSE — let the browser stream it directly.
  if (isStream(url, request)) return;

  if (isApi(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigations and everything else: network, with a cache fallback so the
  // terminal survives a transient drop.
  event.respondWith(networkWithCacheFallback(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Offline and uncached — propagate the failure so the browser shows its
    // own error rather than us returning a confusing empty Response.
    throw err;
  }
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function networkWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (err) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
