import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {
    super();
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      });
      this.client.on('error', (err) => {
        this.logger.warn(`Redis error: ${err.message}`);
      });
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async pingCheck(key: string, options: { timeout?: number } = {}): Promise<HealthIndicatorResult> {
    if (!this.client) {
      return this.getStatus(key, true, {
        status: 'skipped',
        note: 'redis not configured',
      });
    }

    const timeout = options.timeout ?? 2_000;
    const start = Date.now();
    try {
      const result = await Promise.race([
        this.client.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Redis ping timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      if (result !== 'PONG') {
        throw new Error(`Unexpected Redis ping response: ${result}`);
      }
      return this.getStatus(key, true, {
        responseTimeMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(`${key} check failed`, this.getStatus(key, false, { message }));
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}
