import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly mem = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private degraded = false;

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
        setTimeout(
          () => reject(new Error('redis connect timed out after 5s')),
          5000,
        ).unref?.(),
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

  /** Underlying ioredis client, or null if in fallback mode. */
  getClient(): Redis | null {
    return this.client;
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
}
