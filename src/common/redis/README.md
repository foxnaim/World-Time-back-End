# RedisModule

Global module exporting `RedisService` — a thin, degrade-friendly façade
over [ioredis](https://github.com/redis/ioredis). Every backend concern
that needs shared, ephemeral state (OTCs, Telegram sessions, rate-limit
buckets, QR rotation locks, read-through caches, pub/sub) goes through
this service.

## Two modes

| Mode                | Trigger                                  | Semantics                                                            |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| **connected**       | `REDIS_URL` set, initial connect OK      | All ops hit Redis. State shared across replicas. Pub/sub works.      |
| **in-memory fallback** | `REDIS_URL` unset, or initial connect fails | Ops served from a process-local `Map` with `setTimeout`-backed TTLs. |

The process logs a single warning on fallback entry and keeps booting.
`isDegraded()` / `status` expose the current mode; `isRedisReady` is the
stronger signal used by pub/sub consumers.

## When to use RedisService

- **OTCs** (one-time codes for magic-link / Telegram-link exchange) —
  short TTL (2–10 min), must be consumed exactly once.
- **Telegram sessions** — bot conversation state keyed by `telegramId`.
- **Rate-limit counters** — per-user or per-IP INCR with anchored TTL
  (see `incrWithTtl`).
- **Read-through caches** — company-by-slug, precomputed analytics.
- **Distributed locks** — serialize QR rotation so two replicas can't
  both mint tokens for the same company at once.
- **Pub/Sub** — cross-replica SSE fan-out for QR rotations.

## Key namespaces

All keys flow through `./keys.ts`. The table below is the authoritative
schema; see `backend/docs/REDIS.md` for the full reference with
write/read responsibilities.

| Namespace          | Pattern                                            | Purpose                      |
| ------------------ | -------------------------------------------------- | ---------------------------- |
| `auth:otc:*`       | `auth:otc:<code>`                                  | One-time code                |
| `auth:refresh:bl:*`| `auth:refresh:bl:<jti>`                            | Refresh-token blacklist      |
| `tg:session:*`     | `tg:session:<telegramId>`                          | Bot conversation state       |
| `tg:pending-qr:*`  | `tg:pending-qr:<telegramId>`                       | Pending scan intent          |
| `qr:current:*`     | `qr:current:<companyId>`                           | Active QR token              |
| `qr:rot-lock:*`    | `qr:rot-lock:<companyId>`                          | QR rotation lock             |
| `rl:u:*` / `rl:ip:*`| `rl:u:<userId>:<bucket>` / `rl:ip:<ip>:<bucket>`  | Rate-limit counters          |
| `cache:*`          | `cache:company:slug:<slug>`, `cache:analytics:...` | Read-through caches          |
| `billing:seats:*`  | `billing:seats:<companyId>`                        | Seat-count aggregate         |

## TTL policy

| Class              | TTL                  | Notes                                     |
| ------------------ | -------------------- | ----------------------------------------- |
| OTCs               | 2–10 min (`SEC_2M`–`SEC_10M`) | Short enough to limit replay window.      |
| Refresh blacklist  | 7 days (`SEC_7D`)    | Match refresh-token lifetime.             |
| Telegram session   | 1 hour (`SEC_1H`)    | Rolling on activity.                      |
| Rate-limit buckets | 1–60 min             | Anchored on first INCR via `incrWithTtl`. |
| QR rotation lock   | 10–30 s              | Covers normal rotation duration.          |
| Read-through cache | 1 min – 1 day        | Depends on churn of the source.           |

## API surface

`get`, `set(k, v, ttl?)`, `setEx(k, v, ttl)`, `del`, `mget`, `exists`,
`incr`, `incrWithTtl(k, ttl)`, `expire`, `lock(k, ttl)`, `pipeline()`,
`publish`, `subscribe`, `healthPing()`, `status`, `isDegraded()`,
`isRedisReady`, `getClient()` / `getRaw()`. All async except the sync
getters.

## Failover behavior

- Errors after boot are logged but do NOT flip to fallback — ioredis
  reconnects on its own with exponential backoff.
- The boot-time connect race has a 5 s timeout; on timeout we enter
  fallback so the app can still come up.
- Pub/sub uses a dedicated subscriber connection (ioredis requires it
  after `SUBSCRIBE`). Subscriber errors are logged but don't kill the
  service.

## Cold start behavior

On first boot in fallback mode the Map is empty — there are no OTCs or
sessions to restore. Any user mid-flow when Redis died will need to
restart their flow (request a new magic link, re-scan the QR, ...). No
persistence guarantees are made for the fallback; it is a development
convenience and a brownout cushion, not a replacement.
