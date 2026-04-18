/**
 * Tiny LRU cache for the in-memory fallback path of `CacheService`.
 *
 * Implementation notes:
 * - Uses a Map, which preserves insertion order. On read we delete-and-reinsert
 *   to mark the entry as most-recently-used; on write we do the same.
 * - Per-entry `expiresAt` is checked on read (lazy expiry). There's no
 *   background sweep — the Map is bounded to `maxSize` anyway, so dead entries
 *   get evicted either by TTL-on-read or by LRU pressure.
 * - `forEach` / `keys()` skip expired entries transparently so pattern-delete
 *   (used by `delPattern`) never "sees" stale keys.
 */
export interface LruEntry<V> {
  value: V;
  /** Epoch ms when this entry should be considered expired, or `null` for no TTL. */
  expiresAt: number | null;
}

export class InMemoryLru<V = unknown> {
  private readonly store = new Map<string, LruEntry<V>>();

  constructor(private readonly maxSize: number = 1000) {
    if (maxSize <= 0) {
      throw new Error('InMemoryLru: maxSize must be > 0');
    }
  }

  get size(): number {
    return this.store.size;
  }

  /** Returns the value, or `undefined` if missing or expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Mark as most-recently-used: re-insert to bump to the end of the Map.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Sets a key with optional TTL (seconds). */
  set(key: string, value: V, ttlSec?: number): void {
    if (this.store.has(key)) this.store.delete(key);
    const expiresAt = ttlSec != null && ttlSec > 0 ? Date.now() + ttlSec * 1000 : null;
    this.store.set(key, { value, expiresAt });
    // Evict oldest while over capacity. Map iteration order is insertion
    // order, so the first key returned by keys() is the oldest (LRU).
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Delete all keys matching a glob-like pattern (only `*` wildcard is
   * supported — enough to mirror Redis SCAN patterns used by analytics).
   * Returns the number of deleted keys.
   */
  deletePattern(pattern: string): number {
    const re = globToRegex(pattern);
    let deleted = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.store.delete(key);
        continue;
      }
      if (re.test(key)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Convert a Redis-style glob (only `*` wildcard) into a RegExp anchored on
 * both ends. We intentionally do NOT support `?` or `[abc]` — Redis does,
 * but none of our call sites use them and supporting them increases the
 * surface area for surprising matches.
 */
function globToRegex(pattern: string): RegExp {
  // Escape everything except `*`, then replace `*` with `.*`.
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&');
  const body = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${body}$`);
}
