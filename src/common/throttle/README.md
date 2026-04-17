# Throttle

Rate-limiting helpers layered on top of `@nestjs/throttler`.

## Layers

1. **Global default** — `ThrottlerModule.forRoot` in `app.module.ts` sets
   `60 req / 60s` for every route. Applied via `APP_GUARD`
   (`UserThrottlerGuard`) so the bucket key is the authed user id
   (or client IP for anonymous traffic).
2. **Tight per-route limits** — `RATE_LIMITS` in `throttle.constants.ts`
   exports named policies (auth, checkin scan, sheets export, invite).
   Apply with `@Throttle({ default: RATE_LIMITS.X })` on the handler.

## Adding a new policy

1. Add a named entry to `RATE_LIMITS` in `throttle.constants.ts`
   (`{ limit, ttl }`, ttl in ms).
2. Decorate the handler with `@Throttle({ default: RATE_LIMITS.YOUR_KEY })`.
3. If you need per-user vs per-IP behaviour different from the default,
   subclass `UserThrottlerGuard` and override `getTracker`.
