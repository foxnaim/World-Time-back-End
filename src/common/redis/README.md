# RedisModule

Global module that provides `RedisService` — a thin ioredis wrapper used by
auth (OTC storage) and the Telegram session store.

## Usage

```ts
import { RedisService } from '@/common/redis/redis.service';

constructor(private readonly redis: RedisService) {}

await this.redis.set('k', 'v', 120); // 120s TTL
await this.redis.get('k');
await this.redis.del('k');
```

Methods: `get`, `set(key, val, ttlSec?)`, `del`, `mget`, `exists`, `incr`,
`expire`. All return Promises.

## Fallback behavior

When `REDIS_URL` is unset or the initial connection fails, `RedisService`
logs a single warning and serves every call from an in-memory `Map`. TTLs are
honored via per-key `setTimeout` handles (unref'd so they don't keep the
process alive). `isDegraded()` reports which mode is active. The process keeps
working with single-instance semantics — OTCs and sessions won't be shared
across replicas until Redis is back.
