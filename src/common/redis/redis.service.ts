import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { ChainableCommander } from 'ioredis';

/**
 * Thin façade over ioredis with a transparent in-memory fallback.
 *
 * When REDIS_URL is set the service connects on module init. If the URL is
 * absent, or the initial connection fails, the service logs a warning once and
 * serves all operations out of an internal Map. The Map tracks TTLs via
 * per-key setTimeout handles so expired entries are actively purged (not just
 * lazily on read).
 *
 * Methods are intentionally async even on the fallback path, so callers that
 * await them don't change shape when Redis comes online.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private readonly mem = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private degraded = false;

  /**
   * Dedicated connection used exclusively for SUBSCRIBE.
   *
   * ioredis (like redis itself) puts a connection into "subscriber mode"
   * once SUBSCRIBE is issued — on that connection only subscribe-family
   * commands are legal. To continue using normal commands (GET/SET/PUBLISH)
   * we MUST keep a second connection. We create it lazily on first
   * subscribe() call so non-pubsub deployments never pay for it.
   */
  private subClient: Redis | null = null;

  /**
   * Map of channel -> Set of handlers. ioredis fires a single `message`
   * event per subscribed channel; we fan out to every registered handler
   * ourselves. Using a Set makes unsubscribe O(1) by reference.
   */
  private readonly subHandlers = new Map<string, Set<(msg: string) => void>>();

  /** Whether the global `message` listener has been attached to subClient. */
  private subListenerAttached = false;

  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.degraded = true;
      this.logger.warn(
        'REDIS_URL not configured — RedisService running in in-memory fallback mode. ' +
          'OTCs, sessions and rate limits will NOT be shared across instances.',
      );
      return;
    }
    try {
      const client = new Redis(url, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      client.on('error', (err) => {
        this.logger.error(`redis error: ${err.message}`);
      });
      client.on('connect', () => {
        this.logger.log('redis connected');
      });
      client.on('end', () => {
        this.logger.warn('redis connection closed');
      });
      // Cap the connect wait so a misbehaving Redis can't stall boot. On
      // timeout we disconnect and drop into in-memory fallback; the app
      // still comes up.
      const connectPromise = client.connect();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis connect timed out after 5s')), 5000).unref?.(),
      );
      await Promise.race([connectPromise, timeout]);
      this.client = client;
    } catch (err) {
      this.degraded = true;
      this.logger.warn(
        `Failed to connect to Redis (${(err as Error).message}). ` +
          'Falling back to in-memory storage for this process.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.mem.clear();
    // Tear down the subscriber connection (if any) and all per-channel
    // handler sets BEFORE closing the main client. Order matters only for
    // clean logs; both quits race independently.
    if (this.subClient) {
      try {
        await this.subClient.quit();
      } catch {
        this.subClient.disconnect();
      }
      this.subClient = null;
      this.subHandlers.clear();
    }
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }

  /** True when operating without a live Redis connection. */
  isDegraded(): boolean {
    return this.degraded || this.client === null;
  }

  /**
   * True when a live Redis connection is available for pub/sub use.
   * This is the signal consumers (e.g. SseHub) check to decide whether to
   * cross-broadcast rotations via Redis or fall back to in-process only.
   */
  get isRedisReady(): boolean {
    return this.client !== null && !this.degraded;
  }

  /** Underlying ioredis client, or null if in fallback mode. */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Alias for {@link getClient} preferred by newer call sites (pipeline,
   * multi, pub/sub plumbing). Kept alongside `getClient` so existing
   * consumers keep compiling.
   */
  getRaw(): Redis | null {
    return this.client;
  }

  /**
   * Coarse operational status. 'connected' means a live ioredis client is
   * attached; 'fallback' means the in-memory Map is authoritative for this
   * process. Useful for /health endpoints and logging context.
   */
  get status(): 'connected' | 'fallback' {
    return this.client !== null && !this.degraded ? 'connected' : 'fallback';
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    return this.mem.has(key) ? this.mem.get(key)! : null;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (this.client) {
      if (ttlSec != null && ttlSec > 0) {
        await this.client.set(key, value, 'EX', ttlSec);
      } else {
        await this.client.set(key, value);
      }
      return;
    }
    this.mem.set(key, value);
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    if (ttlSec != null && ttlSec > 0) {
      const t = setTimeout(() => {
        this.mem.delete(key);
        this.timers.delete(key);
      }, ttlSec * 1000);
      // Don't keep the process alive for an expiry tick.
      if (typeof (t as any).unref === 'function') (t as any).unref();
      this.timers.set(key, t);
    } else {
      this.timers.delete(key);
    }
  }

  async del(key: string): Promise<number> {
    if (this.client) return this.client.del(key);
    const t = this.timers.get(key);
    if (t) {
      clearTimeout(t);
      this.timers.delete(key);
    }
    return this.mem.delete(key) ? 1 : 0;
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    if (this.client) return this.client.mget(...keys);
    return keys.map((k) => (this.mem.has(k) ? this.mem.get(k)! : null));
  }

  async exists(key: string): Promise<number> {
    if (this.client) return this.client.exists(key);
    return this.mem.has(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    if (this.client) return this.client.incr(key);
    const cur = Number.parseInt(this.mem.get(key) ?? '0', 10) || 0;
    const next = cur + 1;
    this.mem.set(key, String(next));
    return next;
  }

  async expire(key: string, ttlSec: number): Promise<number> {
    if (this.client) return this.client.expire(key, ttlSec);
    if (!this.mem.has(key)) return 0;
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.mem.delete(key);
      this.timers.delete(key);
    }, ttlSec * 1000);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    this.timers.set(key, t);
    return 1;
  }

  // ---------------------------------------------------------------------------
  // Higher-level helpers
  //
  // These are all implementable in terms of the primitives above, but writing
  // them once here removes a class of bugs (forgetting EX, forgetting to set
  // TTL only on first INCR, releasing a lock that wasn't ours, ...).
  // ---------------------------------------------------------------------------

  /**
   * Set `key` to `value` with an explicit TTL (seconds). Prefer this over
   * `set(key, value, ttl)` when the TTL is a non-optional part of the
   * semantics — it reads as "this entry definitionally expires".
   */
  async setEx(key: string, value: string, ttlSec: number): Promise<void> {
    await this.set(key, value, ttlSec);
  }

  /**
   * Atomically increment `key` and set its TTL to `ttlSec` on the FIRST
   * increment only (i.e. the transition from absent → 1). Subsequent
   * increments leave the TTL untouched, so the window is anchored to the
   * first hit — the shape rate-limiter buckets want.
   *
   * On real Redis we use a pipelined INCR + conditional EXPIRE; the `1`
   * check happens server-side implicitly because we only EXPIRE when INCR
   * returned 1. On the in-memory fallback we do the same logic locally.
   */
  async incrWithTtl(key: string, ttlSec: number): Promise<number> {
    if (this.client) {
      // A tiny pipeline beats two round-trips; the EXPIRE is still a
      // separate command but it ships in the same batch.
      const pipe = this.client.pipeline();
      pipe.incr(key);
      pipe.expire(key, ttlSec, 'NX');
      const results = await pipe.exec();
      // results is [[err, count], [err, expireResult]]; surface the count.
      if (!results || !results[0]) return 0;
      const [err, count] = results[0];
      if (err) throw err;
      return Number(count) || 0;
    }
    const next = await this.incr(key);
    if (next === 1) await this.expire(key, ttlSec);
    return next;
  }

  /**
   * Acquire a simple distributed lock using SET NX EX. Returns an async
   * `unlock` function that releases the lock IFF we still own it (we only
   * DEL when the stored token matches ours — this prevents a slow holder
   * from releasing someone else's re-acquired lock).
   *
   * Returns `null` if the lock could not be acquired right now. Callers
   * decide whether to retry/backoff or skip — we don't busy-wait here.
   *
   * On the in-memory fallback the lock is still correct within a single
   * process. Across replicas it degrades to "no coordination", which is
   * the same failure mode every other primitive in this service has when
   * Redis is absent.
   */
  async lock(key: string, ttlSec: number): Promise<(() => Promise<void>) | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (this.client) {
      const res = await this.client.set(key, token, 'EX', ttlSec, 'NX');
      if (res !== 'OK') return null;
      return async () => {
        // Lua guard: only DEL when the value still matches our token.
        try {
          await this.client?.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            key,
            token,
          );
        } catch (err) {
          this.logger.warn(
            `lock release failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
    }
    // In-memory path: mimic SET NX EX semantics against our Map.
    if (this.mem.has(key)) return null;
    await this.set(key, token, ttlSec);
    return async () => {
      if (this.mem.get(key) === token) await this.del(key);
    };
  }

  /**
   * Passthrough to ioredis pipeline for callers that need to batch
   * commands. Returns `null` in fallback mode — callers should feature-
   * detect and fall back to sequential primitives.
   */
  pipeline(): ChainableCommander | null {
    return this.client ? this.client.pipeline() : null;
  }

  /**
   * Round-trip PING latency in milliseconds, or `null` when we're in
   * fallback mode (no network to measure). Suitable for /health probes.
   */
  async healthPing(): Promise<number | null> {
    if (!this.client) return null;
    const t0 = Date.now();
    try {
      await this.client.ping();
      return Date.now() - t0;
    } catch (err) {
      this.logger.warn(`healthPing failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Pub/Sub
  //
  // Thin passthrough to ioredis's PUBLISH/SUBSCRIBE. When Redis is degraded
  // we intentionally no-op: callers (SseHub) detect this via isRedisReady
  // and keep their in-memory Subject path authoritative. We do NOT try to
  // simulate pub/sub in-memory — that would mask the real requirement
  // (cross-replica broadcast) and create misleading dev-vs-prod drift.
  // ---------------------------------------------------------------------------

  /**
   * Publish a message to `channel`. Returns the number of Redis subscribers
   * that received it (per PUBLISH semantics). Returns 0 when the service is
   * in fallback mode — callers should not depend on this number for
   * correctness, only as a coarse diagnostic.
   */
  async publish(channel: string, message: string): Promise<number> {
    if (!this.client) return 0;
    return this.client.publish(channel, message);
  }

  /**
   * Subscribe to `channel`. Returns an async unsubscribe function that the
   * caller MUST invoke when it no longer needs messages, to avoid leaking
   * handlers (and eventually keeping Redis SUBSCRIBE entries alive forever).
   *
   * Multiple subscribers to the same channel share a single underlying
   * SUBSCRIBE — we only SUBSCRIBE on the first handler for that channel and
   * UNSUBSCRIBE when the last handler detaches. This matters under SSE load
   * because N browser tabs for one company resolve to 1 Redis subscription,
   * not N.
   *
   * If Redis is unavailable the returned unsubscribe is a no-op; no handler
   * is ever invoked. The caller's fallback path (in-memory Subject) carries
   * the traffic.
   */
  async subscribe(channel: string, handler: (msg: string) => void): Promise<() => Promise<void>> {
    if (!this.client) {
      // No connection — return a noop unsub. Caller's fallback handles delivery.
      return async () => {};
    }

    // Lazily create the dedicated subscriber connection on first use and
    // attach the single multiplexing message listener.
    if (!this.subClient) {
      const url = this.config.get<string>('REDIS_URL');
      if (!url) return async () => {};
      this.subClient = new Redis(url, {
        maxRetriesPerRequest: null, // subscriber connections shouldn't bail on retries
        enableReadyCheck: true,
      });
      this.subClient.on('error', (err) => {
        this.logger.error(`redis sub error: ${err.message}`);
      });
    }
    if (!this.subListenerAttached) {
      // Fan out a single ioredis `message` event to every handler registered
      // for that channel. Handlers run synchronously relative to each other;
      // we swallow per-handler throws so one bad subscriber can't kill the
      // fan-out for the rest.
      this.subClient.on('message', (ch: string, msg: string) => {
        const handlers = this.subHandlers.get(ch);
        if (!handlers || handlers.size === 0) return;
        for (const h of handlers) {
          try {
            h(msg);
          } catch (err) {
            this.logger.warn(
              `sub handler threw on channel=${ch}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      });
      this.subListenerAttached = true;
    }

    let handlers = this.subHandlers.get(channel);
    const isFirstForChannel = !handlers || handlers.size === 0;
    if (!handlers) {
      handlers = new Set();
      this.subHandlers.set(channel, handlers);
    }
    handlers.add(handler);

    if (isFirstForChannel) {
      await this.subClient.subscribe(channel);
    }

    let unsubscribed = false;
    return async () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const set = this.subHandlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.subHandlers.delete(channel);
        // Last handler gone: release the Redis subscription so the server
        // isn't tracking a dead channel for us.
        if (this.subClient) {
          try {
            await this.subClient.unsubscribe(channel);
          } catch (err) {
            this.logger.warn(
              `unsubscribe(${channel}) failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    };
  }
}
