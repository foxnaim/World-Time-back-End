/**
 * Centralized Redis key builder.
 *
 * All Redis keys used by the backend MUST be produced through this module.
 * Inline string concatenation (`` `auth:otc:${code}` ``) is discouraged —
 * it scatters the key schema across the codebase and makes ops work
 * (inspection, migration, flush policy) error-prone.
 *
 * Namespace convention: `<domain>:<entity>:<subtype>?:<id>`
 *   - domain:  the broad capability (auth, tg, qr, rl, cache, billing, ...)
 *   - entity:  the object kind (otc, session, refresh, ...)
 *   - subtype: optional modifier (bl for blacklist, slug for lookup-by-slug)
 *   - id:      the stable identifier (uuid, telegramId, companyId)
 *
 * Colons (`:`) are the namespace separator. IDs are embedded as-is; callers
 * are responsible for ensuring they don't contain `:` or whitespace (all
 * of our IDs are UUIDs, bigints, or URL-safe slugs — so this is safe by
 * construction).
 */

export const REDIS_KEYS = {
  /** Authentication-related short-lived state. */
  auth: {
    /** One-time code used during magic-link / Telegram-link exchange. */
    otc: (code: string) => `auth:otc:${code}`,
    /** Refresh-token blacklist entry keyed by JWT id. */
    refreshBlacklist: (jti: string) => `auth:refresh:bl:${jti}`,
  },
  /** Telegram bot session + pending-action state. */
  telegram: {
    /** Active conversation/session state for a Telegram user. */
    session: (telegramId: bigint | string) => `tg:session:${telegramId}`,
    /** Pending QR-scan intent (user scanned but hasn't confirmed yet). */
    pendingQr: (telegramId: bigint | string) => `tg:pending-qr:${telegramId}`,
  },
  /** QR token + rotation coordination. */
  qr: {
    /** Currently-active QR token for a company (read by scanners). */
    currentToken: (companyId: string) => `qr:current:${companyId}`,
    /** Distributed lock held during QR rotation to serialize rotations. */
    rotationLock: (companyId: string) => `qr:rot-lock:${companyId}`,
  },
  /** Throttler/rate-limit counters. */
  ratelimit: {
    /** Per-user bucket (e.g. login attempts, sms sends). */
    user: (userId: string, bucket: string) => `rl:u:${userId}:${bucket}`,
    /** Per-IP bucket (e.g. anon endpoints, magic-link request). */
    ip: (ip: string, bucket: string) => `rl:ip:${ip}:${bucket}`,
  },
  /** Read-through cache entries. */
  cache: {
    /** Company lookup by slug (TTL-scoped to avoid stale tenant metadata). */
    companyBySlug: (slug: string) => `cache:company:slug:${slug}`,
    /** Precomputed monthly analytics payload for a company. */
    analyticsMonthly: (companyId: string, month: string) =>
      `cache:analytics:company:${companyId}:${month}`,
  },
  /** Billing-related cached aggregates. */
  billing: {
    /** Active seat count for a company (used by quota enforcement). */
    seatCount: (companyId: string) => `billing:seats:${companyId}`,
  },
} as const;

/**
 * Canonical TTL values (seconds). Prefer these constants over magic numbers
 * at call sites so operational policy is visible in one place.
 */
export const TTL = {
  SEC_1M: 60,
  SEC_2M: 120,
  SEC_10M: 600,
  SEC_1H: 3600,
  SEC_1D: 86400,
  SEC_7D: 604800,
} as const;

export type RedisKeyNamespace = keyof typeof REDIS_KEYS;
