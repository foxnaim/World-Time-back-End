/**
 * Centralised per-route throttle policies.
 *
 * The global default (registered in AppModule) is 60 requests / minute per
 * tracker. The values below are *tighter* caps applied to specific handlers
 * via `@Throttle({ default: RATE_LIMITS.* })`. Keep them named and grouped
 * so callers can discover them without re-deriving raw numbers.
 *
 * `ttl` is milliseconds (the `@nestjs/throttler` v5+ convention).
 */
export const RATE_LIMITS = {
  /** Authentication endpoints — brute-force & OTC replay protection. */
  AUTH: {
    /** Generic auth routes (refresh, verify) — 10/min. */
    default: { limit: 10, ttl: 60_000 },
    /** Telegram bot login / initData verify — 5/min per tracker. */
    botLogin: { limit: 5, ttl: 60_000 },
  },

  /** POST /checkin/scan — users shouldn't scan more than ~1 every 3s. */
  CHECKIN_SCAN: { limit: 20, ttl: 60_000 },

  /** Heavy Google Sheets export — 3/min, expensive network + I/O. */
  SHEETS_EXPORT: { limit: 3, ttl: 60_000 },

  /** POST /companies/:id/employees/invite — 30/hour to curb link spam. */
  TELEGRAM_INVITE: { limit: 30, ttl: 3_600_000 },
} as const;

export type RateLimitPolicy = { limit: number; ttl: number };
