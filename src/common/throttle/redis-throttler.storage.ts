import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

// ThrottlerStorageRecord is exported as a type-only member from a nested
// path in @nestjs/throttler v6; the barrel `index.d.ts` doesn't re-export it.
// Declaring it locally avoids reaching into `dist/`.
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

import { RedisService } from '../redis/redis.service';

/**
 * Internal record used by the in-memory fallback path. Mirrors the shape
 * the storage returns to ThrottlerGuard so the fallback is behaviorally
 * equivalent from the guard's point of view.
 */
interface MemoryRecord {
  hits: number;
  /** Absolute epoch-ms when the window expires. */
  expiresAt: number;
  /** Absolute epoch-ms when the block expires, or 0 if not blocked. */
  blockedUntil: number;
}

/**
 * Options for {@link RedisThrottlerStorage}. The `enabled` flag exists so
 * tests (or callers that don't want distributed state) can force the
 * in-memory path even when a healthy RedisService is provided.
 */
export interface RedisThrottlerStorageOptions {
  /**
   * When false, the storage never touches Redis and serves everything from
   * its internal Map. Defaults to true. Tests should pass `false` for
   * deterministic, isolated behavior.
   */
  enabled?: boolean;
}

/**
 * `ThrottlerStorage` implementation backed by Redis, with a transparent
 * in-memory fallback when Redis is unavailable.
 *
 * The storage keys the sliding window by `throttle:<throttlerName>:<key>`
 * and uses INCR + EXPIRE to maintain an atomic counter. On the first hit
 * (INCR returns 1) we set the key's TTL; subsequent hits just increment.
 * Once the count exceeds the limit we stamp a secondary `block:*` key with
 * `blockDuration` TTL so the block survives the original window's expiry.
 *
 * Fallback: whenever `RedisService.isDegraded()` reports true — or the
 * storage was constructed with `enabled: false` — we route through an
 * internal Map. The Map path is single-process only; multi-instance
 * deployments that land here will not share counters. This matches the
 * semantics of `RedisService` itself and lets the app stay up if Redis
 * blips.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly mem = new Map<string, MemoryRecord>();
  private readonly enabled: boolean;

  constructor(
    private readonly redis: RedisService | null,
    options: RedisThrottlerStorageOptions = {},
  ) {
    this.enabled = options.enabled ?? true;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.shouldUseRedis()) {
      return this.incrementMemory(key, ttl, limit, blockDuration, throttlerName);
    }
    try {
      return await this.incrementRedis(key, ttl, limit, blockDuration, throttlerName);
    } catch (err) {
      // Any Redis mishap should degrade to memory rather than reject the
      // request. A rate-limit miss is a lesser evil than a 500.
      this.logger.warn(
        `Redis throttler increment failed (${(err as Error).message}) — falling back to in-memory`,
      );
      return this.incrementMemory(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  private shouldUseRedis(): boolean {
    if (!this.enabled) return false;
    if (!this.redis) return false;
    return !this.redis.isDegraded();
  }

  private hitKey(throttlerName: string, key: string): string {
    return `throttle:${throttlerName}:${key}`;
  }

  private blockKey(throttlerName: string, key: string): string {
    return `throttle:block:${throttlerName}:${key}`;
  }

  private async incrementRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis!.getClient();
    if (!client) {
      return this.incrementMemory(key, ttl, limit, blockDuration, throttlerName);
    }

    const hitKey = this.hitKey(throttlerName, key);
    const blockKey = this.blockKey(throttlerName, key);
    const ttlSec = Math.max(1, Math.ceil(ttl / 1000));
    const blockSec = Math.max(1, Math.ceil(blockDuration / 1000));

    // Honor an active block before touching the counter: while blocked we
    // neither increment nor re-extend the window, matching the default
    // throttler's semantics.
    const blockPttl = await client.pttl(blockKey);
    if (blockPttl > 0) {
      const hitPttl = await client.pttl(hitKey);
      const totalHitsStr = await client.get(hitKey);
      const totalHits = totalHitsStr ? Number.parseInt(totalHitsStr, 10) : limit + 1;
      return {
        totalHits,
        timeToExpire: hitPttl > 0 ? Math.ceil(hitPttl / 1000) : 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockPttl / 1000),
      };
    }

    const totalHits = await client.incr(hitKey);
    if (totalHits === 1) {
      await client.pexpire(hitKey, ttl);
    }

    let timeToExpire: number;
    const pttl = await client.pttl(hitKey);
    if (pttl < 0) {
      // Edge case: INCR raced with expiry. Re-stamp and treat as a fresh window.
      await client.pexpire(hitKey, ttl);
      timeToExpire = ttlSec;
    } else {
      timeToExpire = Math.ceil(pttl / 1000);
    }

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit) {
      // First time we observe overflow, stamp the block key. SET with NX so
      // concurrent overflow hits don't repeatedly re-extend the block TTL.
      const set = await client.set(blockKey, '1', 'PX', blockDuration, 'NX');
      isBlocked = true;
      if (set === 'OK') {
        timeToBlockExpire = blockSec;
      } else {
        const existing = await client.pttl(blockKey);
        timeToBlockExpire = existing > 0 ? Math.ceil(existing / 1000) : blockSec;
      }
    }

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }

  private incrementMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ThrottlerStorageRecord {
    const hitKey = this.hitKey(throttlerName, key);
    const blockKey = this.blockKey(throttlerName, key);
    const now = Date.now();

    // Clean expired block, if any.
    const blockRec = this.mem.get(blockKey);
    if (blockRec && blockRec.blockedUntil <= now) {
      this.mem.delete(blockKey);
    }
    const activeBlock = this.mem.get(blockKey);
    if (activeBlock && activeBlock.blockedUntil > now) {
      const hitRec = this.mem.get(hitKey);
      return {
        totalHits: hitRec?.hits ?? limit + 1,
        timeToExpire: hitRec ? Math.max(0, Math.ceil((hitRec.expiresAt - now) / 1000)) : 0,
        isBlocked: true,
        timeToBlockExpire: Math.max(1, Math.ceil((activeBlock.blockedUntil - now) / 1000)),
      };
    }

    let rec = this.mem.get(hitKey);
    if (!rec || rec.expiresAt <= now) {
      rec = { hits: 0, expiresAt: now + ttl, blockedUntil: 0 };
    }
    rec.hits += 1;
    this.mem.set(hitKey, rec);

    const timeToExpire = Math.max(1, Math.ceil((rec.expiresAt - now) / 1000));
    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (rec.hits > limit) {
      isBlocked = true;
      const existing = this.mem.get(blockKey);
      if (!existing || existing.blockedUntil <= now) {
        const blockedUntil = now + blockDuration;
        this.mem.set(blockKey, { hits: 0, expiresAt: blockedUntil, blockedUntil });
        timeToBlockExpire = Math.max(1, Math.ceil(blockDuration / 1000));
      } else {
        timeToBlockExpire = Math.max(1, Math.ceil((existing.blockedUntil - now) / 1000));
      }
    }

    return {
      totalHits: rec.hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire,
    };
  }
}
