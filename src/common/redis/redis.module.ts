import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { RedisService } from './redis.service';

/**
 * Injection token for the raw ioredis client. Provided as `null` when
 * REDIS_URL is not configured or the connection cannot be established — in
 * that mode the `RedisService` keeps serving requests out of an in-memory
 * Map, logging a single warning on startup.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const logger = new Logger('RedisModule');
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          logger.warn(
            'REDIS_URL not configured — REDIS_CLIENT provided as null. ' +
              'RedisService will use in-memory fallback.',
          );
          return null;
        }
        try {
          const client = new Redis(url, {
            maxRetriesPerRequest: 3,
            lazyConnect: false,
          });
          client.on('error', (err) => {
            logger.error(`redis error: ${err.message}`);
          });
          client.on('connect', () => {
            logger.log('redis connected (REDIS_CLIENT)');
          });
          return client;
        } catch (err) {
          logger.warn(
            `Failed to construct Redis client: ${(err as Error).message}. ` +
              'Providing null; RedisService will fall back to in-memory.',
          );
          return null;
        }
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
