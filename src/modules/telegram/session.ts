import { Logger } from '@nestjs/common';
import type { RedisService } from '@/common/redis/redis.service';

export interface TelegramSession {
  lastLocation?: { lat: number; lng: number; at: number };
  pendingQr?: string;
}

/**
 * Session storage for the Telegram bot.
 *
 * API contract (unchanged by this refactor):
 *
 *   getSession(telegramId)   → TelegramSession  (synchronous)
 *   clearSession(telegramId) → void             (synchronous)
 *
 * Callers receive a plain-looking object and mutate it directly (see
 * handlers/checkin.handler.ts, handlers/start.handler.ts). To keep that API
 * while also persisting to Redis, the returned object is a Proxy that
 * write-throughs every field assignment to Redis in the background. Reads
 * always resolve against an in-memory Map, which is seeded lazily from Redis
 * on first access for a given telegram ID.
 *
 * When no Redis backend is wired up (REDIS_URL unset, or in tests), the Proxy
 * simply behaves as a plain object backed by the Map — equivalent to the
 * previous implementation.
 */

const TTL_SEC = 60 * 60 * 24; // sessions are ephemeral — 24h is plenty.
const KEY_PREFIX = 'tg:session:';
const logger = new Logger('TelegramSession');

/**
 * We keep the raw mutable object separately from the Proxy. Reads against the
 * Proxy default-trap to the raw object; writes go through the `set` trap so
 * they can fan out to Redis. Hydration writes directly to the raw to avoid
 * triggering a redundant Redis write-back for data we just loaded.
 */
const raws = new Map<string, TelegramSession>();
const store = new Map<string, TelegramSession>();
const hydrated = new Set<string>();
let redisRef: RedisService | null = null;

/**
 * Wire a RedisService instance into the session store. Called at module
 * bootstrap time by `TelegramModule`. Safe to call multiple times; the last
 * call wins.
 *
 * Keeping the wiring as a module-level setter (rather than DI on a class)
 * preserves the functional `getSession`/`clearSession` exports that handlers
 * already depend on — no caller has to change.
 */
export function registerSessionRedis(redis: RedisService | null): void {
  redisRef = redis;
}

function keyOf(telegramId: bigint | string | number): string {
  return KEY_PREFIX + telegramId.toString();
}

function persist(telegramId: string, snapshot: TelegramSession): void {
  const redis = redisRef;
  if (!redis) return;
  // JSON-serialize with BigInt/undefined safety.
  const payload = JSON.stringify(snapshot, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  void redis.set(KEY_PREFIX + telegramId, payload, TTL_SEC).catch((err) => {
    logger.warn(`redis set session failed: ${(err as Error).message ?? err}`);
  });
}

function hydrate(telegramId: string): void {
  const redis = redisRef;
  if (!redis || hydrated.has(telegramId)) return;
  hydrated.add(telegramId);
  const raw = raws.get(telegramId);
  if (!raw) return;
  void redis
    .get(KEY_PREFIX + telegramId)
    .then((val) => {
      if (!val) return;
      try {
        const parsed = JSON.parse(val) as TelegramSession;
        // Only fill gaps — do not clobber mutations that happened while we
        // were awaiting the round-trip. Writes go direct to `raw` so the
        // Proxy's persist side-effect doesn't fire for freshly-loaded data.
        if (parsed.lastLocation && !raw.lastLocation) {
          raw.lastLocation = parsed.lastLocation;
        }
        if (parsed.pendingQr && !raw.pendingQr) {
          raw.pendingQr = parsed.pendingQr;
        }
      } catch (err) {
        logger.warn(
          `redis session parse failed for ${telegramId}: ${(err as Error).message ?? err}`,
        );
      }
    })
    .catch((err) => logger.warn(`redis get session failed: ${(err as Error).message ?? err}`));
}

function wrap(telegramId: string, target: TelegramSession): TelegramSession {
  return new Proxy(target, {
    set(obj, prop, value): boolean {
      (obj as any)[prop] = value;
      persist(telegramId, obj);
      return true;
    },
    deleteProperty(obj, prop): boolean {
      delete (obj as any)[prop];
      persist(telegramId, obj);
      return true;
    },
  });
}

export function getSession(telegramId: bigint | string | number): TelegramSession {
  const key = telegramId.toString();
  let s = store.get(key);
  if (!s) {
    const raw: TelegramSession = {};
    raws.set(key, raw);
    s = wrap(key, raw);
    store.set(key, s);
  }
  hydrate(key);
  return s;
}

export function clearSession(telegramId: bigint | string | number): void {
  const key = telegramId.toString();
  store.delete(key);
  raws.delete(key);
  hydrated.delete(key);
  const redis = redisRef;
  if (redis) {
    void redis.del(keyOf(telegramId)).catch((err) => {
      logger.warn(`redis del session failed: ${(err as Error).message ?? err}`);
    });
  }
}
