import { Injectable, Logger } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

import { RedisService } from '../../../common/redis/redis.service';

/**
 * Readiness indicator for Redis.
 *
 * Delegates the actual probe to {@link RedisService.healthPing}, which owns
 * the single ioredis connection for the process, already wraps the PING in
 * a timeout, and returns `null` on failure instead of throwing. This avoids
 * the old failure mode where the indicator created its OWN lazy ioredis
 * client with `enableOfflineQueue: false`; if that side-client's socket
 * wasn't writable at probe time ioredis rejected with
 *   "Stream isn't writeable and enableOfflineQueue options is false"
 * even though the app's real Redis connection was fine — producing spurious
 * 503s from /healthz/ready.
 *
 * When the service is in `fallback` mode (no REDIS_URL configured, or the
 * initial connect failed and we're running on the in-memory Map), we report
 * the probe as healthy with a `mode: 'fallback'` note. The app is
 * intentionally designed to serve traffic in that mode; failing readiness
 * would take the pod out of rotation for a condition that isn't actually
 * degraded from the caller's point of view.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(private readonly redis: RedisService) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    if (this.redis.status === 'fallback') {
      return this.getStatus(key, true, { mode: 'fallback' });
    }
    try {
      const latency = await this.redis.healthPing();
      if (latency === null) {
        throw new Error('ping returned null');
      }
      return this.getStatus(key, true, { latencyMs: latency });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(
        'redis health check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }

  /**
   * True when the probe should run against a real Redis connection. We
   * consider Redis "configured" when either the service has a live client
   * (status !== 'fallback') OR the operator explicitly set REDIS_URL — in
   * the latter case a fallback status means Redis SHOULD be there but we
   * couldn't reach it at boot, and the probe should still run so the
   * transition back to healthy is observable.
   */
  isConfigured(): boolean {
    return this.redis.status !== 'fallback' || Boolean(process.env.REDIS_URL);
  }
}
