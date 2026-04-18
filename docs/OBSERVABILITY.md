# Observability

This document describes how the Work Tact backend is observed in production and
development: how logs are structured, how errors are captured, how metrics will
be exposed, and how operators should wire alerts, dashboards, and debug
sessions.

The philosophy is simple: make the running system legible enough that any
incident can be understood from the outside, without attaching a debugger to a
live container. Every request is tagged with a correlation ID, every error
bubbles up to a central collector, and every sensitive value is redacted at
source rather than filtered downstream.

## Three Pillars

- **Logs** — pino structured JSON, redacted at source
- **Errors** — Sentry (when SENTRY_DSN set)
- **Metrics** — (future) Prometheus /api/metrics endpoint via prom-client

The three pillars are complementary, not redundant. Logs answer *what
happened*, errors answer *what broke and where*, and metrics answer *how often
and how fast*. An effective on-call rotation relies on all three; a team that
only reads logs ends up grepping timestamps, and a team that only watches
dashboards misses subtle regressions that never trip a threshold.

## Logging (pino via nestjs-pino)

Config: `backend/src/common/logger/logger.module.ts`.

Features:
- JSON in prod, pretty in dev (via pino-pretty transport)
- Log level from `LOG_LEVEL` env (default info)
- Redacted paths: `req.headers.authorization`, `req.headers.cookie`,
  `*.password`, `*.token`, `*.initData`
- Correlation ID: request-scoped via `CorrelationMiddleware` → `req.id`
- Response status-aware levels: 5xx=error, 4xx=warn, 2xx=info

The logger is registered globally (`@Global()`) so any Nest provider can inject
a `PinoLogger` without importing `LoggerModule`. Request IDs are honoured from
the `X-Request-Id` header when the caller supplies one (useful for tracing a
request that originated in the frontend or another upstream service) and
otherwise generated via `randomUUID()`. The same ID is echoed back in the
response so clients can surface it in bug reports.

Health and metrics endpoints (`/health`, `/metrics`, `/api/docs`) are excluded
from auto-logging to keep the log stream signal-heavy. They still emit logs on
error — the `autoLogging.ignore` predicate only suppresses the happy path.

### Using Logger in Services
```ts
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

@Injectable()
export class MyService {
  constructor(
    @InjectPinoLogger(MyService.name) private logger: PinoLogger,
  ) {}
  doThing() {
    this.logger.info({ userId }, 'User did thing');
  }
}
```

Pass the structured payload as the *first* argument and the message as the
second. This matches pino's convention and keeps the message field free of
interpolation. Avoid string concatenation — `this.logger.info('user ' + id)`
defeats structured search.

### Log Levels

| Level | When to use                                                      |
|-------|------------------------------------------------------------------|
| trace | Never commit trace logs; use only while debugging locally         |
| debug | Request payloads, SQL plans, feature-flag decisions              |
| info  | Business events (check-in created, QR rotated, user invited)     |
| warn  | Recoverable anomalies (retry succeeded, deprecated endpoint hit) |
| error | Unhandled exception, downstream dependency failure               |
| fatal | Process-level failure; triggers a restart                        |

`LOG_LEVEL` is set via env. In production the default is `info`. Set to `debug`
temporarily to investigate an issue; never leave it there — the verbosity
overwhelms downstream aggregation and can leak sensitive payloads that the
redact rules only cover by path, not by content.

### Log Aggregation
Recommended stacks:
- **Loki + Grafana** — self-hosted, cheap
- **Datadog** — SaaS, powerful
- **Papertrail** — simple
- **CloudWatch Logs** — AWS native

Pino JSON is ingestion-ready. For Loki, use promtail with
`pipeline_stages: [json: {expressions: {level, msg, req: req, res: res}}]`.

For Datadog, the `DD_LOGS_INJECTION=true` env var auto-injects trace IDs when
the Datadog tracer is loaded. For CloudWatch, write logs to stdout as usual
and let the Fargate/ECS agent forward them — no code change needed.

Retention policy is environment-specific. A sensible default is 7 days of hot
storage for info+ and 30 days of cold storage for warn+. Error events live in
Sentry independently, so log retention only needs to cover the debugging
window, not the compliance window.

## Errors (Sentry)

Config: `backend/src/instrument.ts` (loaded FIRST in main.ts).

Features:
- `@sentry/nestjs` with `@sentry/profiling-node`
- `tracesSampleRate: 0.1`
- Environment = NODE_ENV
- Graceful no-op when SENTRY_DSN missing
- Global filter at `backend/src/common/filters/sentry.filter.ts` captures
  unhandled exceptions

Sentry must be imported *before* any instrumented module, which is why
`instrument.ts` is the first import in `main.ts`. Loading it later means the
HTTP and Prisma integrations miss spans that were created before Sentry's
patching ran.

The `sentryEnabled` flag gates the init call so that local development and CI
environments without a DSN do not spam a sandbox project. In production the
DSN is always set, and a missing DSN should be treated as a deployment
regression — add a readiness probe that warns if `sentryEnabled` is false in
`NODE_ENV=production`.

### Best Practices
- Never log full request body — redact first
- Add user context: `Sentry.setUser({ id: userId })` in auth guard (TODO wire in)
- Tag by module: `Sentry.withScope(s => { s.setTag('module', 'checkin'); ... })`
- Attach correlation ID as a tag so Sentry events cross-link to log entries:
  `scope.setTag('requestId', req.id)`
- Use `Sentry.addBreadcrumb` for soft failures that precede the error (e.g.
  a Redis ping that failed before the Postgres write that eventually threw)
- Never pass raw DTOs to `Sentry.captureException` as `extra` — they may
  contain PII. Summarise instead: `{ userId, action, entityId }`

### Sampling

`tracesSampleRate: 0.1` captures 10% of traces. Errors are always captured
regardless of the trace sample rate — the sample rate only affects
performance/tracing spans. Bump to 1.0 temporarily when investigating
latency regressions; remember to revert to avoid quota burn.

Frontend: `@sentry/nextjs` instruments client/server/edge via
`sentry.*.config.ts`. Replay on error enabled (1.0 sample).

## Metrics (Planned)

TODO: Add `/api/metrics` endpoint exposing Prometheus text format via
`prom-client`. Key series:
- `worktime_checkins_total{company,type}` — counter
- `worktime_qr_rotations_total` — counter
- `worktime_auth_attempts_total{result}` — counter
- `worktime_time_entries_duration_seconds` — histogram
- `worktime_db_query_duration_seconds` — histogram (Prisma $extends)
- `worktime_http_requests_total{method,route,status}` — counter (from
  pino-http middleware)
- `worktime_http_request_duration_seconds` — histogram

Scrape config (`prometheus.yml`):
```yaml
scrape_configs:
  - job_name: worktime-backend
    static_configs:
      - targets: ['backend:4000']
    metrics_path: /api/metrics
    scrape_interval: 15s
```

Label cardinality matters: `route` must be the templated path
(`/api/users/:id`) not the concrete URL (`/api/users/42`), otherwise each user
ID spawns a new series and the TSDB explodes. Nest's route metadata exposes
the template — capture it from the handler reflection, not from `req.url`.

The `company` label on `worktime_checkins_total` is bounded by the tenant
count, which is expected to stay below a few thousand. If the product ever
opens to self-serve signup, revisit the label strategy before onboarding the
100,000th tenant.

## Tracing (Planned)

TODO: OpenTelemetry via `@sentry/opentelemetry-node` or
`@opentelemetry/sdk-node`. Exporters: OTLP → Jaeger / Honeycomb / Sentry
Performance.

Trace context should propagate via the W3C `traceparent` header. The backend
already accepts `X-Request-Id`; when tracing lands, map `traceparent.traceId`
to the request ID so the two IDs are the same value in logs, errors, and
spans. A single ID that links all three pillars turns "find the span for this
log line" from grep-archaeology into a constant-time lookup.

## Health Checks

- `GET /api/healthz/live` — always 200 if process responsive
- `GET /api/healthz/ready` — 200 iff Postgres + Redis pingable; 503 otherwise
- `GET /api/health` — legacy alias, returns version + uptime

Uptime monitor hook: POST `GET /api/healthz/ready` every 30s.

Liveness and readiness serve different consumers. Kubernetes uses liveness to
decide whether to restart a pod; it should never fail unless the process is
truly wedged. Readiness gates traffic: a pod that can't reach Postgres should
be yanked from the service, but not killed — the database may recover in
seconds. `/api/healthz/ready` checks both Postgres and Redis because the
application is unusable without either (Redis holds rotating QR state and
session tokens; Postgres holds everything else).

The legacy `/api/health` endpoint is kept for the uptime monitor and external
status pages that were wired up before the split. New integrations should use
`/api/healthz/*`.

## Dashboards (Grafana examples)

### Request Rate
Panel: Graph
Query: `sum by (route) (rate(worktime_http_requests_total[5m]))`

### Error Rate
Query: `sum(rate(worktime_http_requests_total{status=~"5.."}[5m]))`

### p99 Latency
Query: `histogram_quantile(0.99, sum(rate(worktime_http_request_duration_seconds_bucket[5m])) by (le, route))`

### Check-in Throughput
Query: `sum by (company) (rate(worktime_checkins_total{type="IN"}[1h]))`

### Suggested Row Layout

A single-pane "Backend Overview" dashboard with rows per concern is easier to
scan than a sprawling grid:

1. **Traffic** — request rate by route, request rate by method, top routes
   by volume
2. **Errors** — 5xx rate, 4xx rate, Sentry event rate (from the Sentry data
   source plugin)
3. **Latency** — p50/p95/p99 overall, p99 by route, DB query p99
4. **Dependencies** — Postgres active connections, Redis latency, outbound
   HTTP to Telegram API
5. **Business** — check-ins per company, QR rotation cadence, auth success
   rate

Keep each panel's time range consistent and link the dashboard to a Grafana
variable for `company` so tenant-specific incidents can be scoped in one
click.

## Alerts (PagerDuty / Slack)

| Alert | Condition | Severity |
|-------|-----------|----------|
| Backend down | readyz fails 3x in a row | P1 |
| High error rate | 5xx rate > 1% over 5m | P2 |
| DB saturation | Prisma active connections > 80% of pool | P2 |
| QR rotation stalled | No `worktime_qr_rotations_total` increment in 60s | P2 |
| Auth anomaly | auth_attempts_total{result="fail"} rate > 10x baseline | P3 |

Severity levels map to escalation paths:
- **P1** — pages the on-call engineer immediately, 24/7
- **P2** — pages during business hours, Slack notification otherwise
- **P3** — Slack notification only, reviewed in the next business day

Every alert should have a runbook link in the alert description. An alert
that fires without a runbook is an alert that will wake someone up at 3am
and leave them guessing.

## Redaction & PII

Per GDPR, never log:
- Raw location coordinates (log "location received" without lat/lng)
- Telegram initData (HMAC-signed payload contains user profile)
- JWTs, refresh tokens, OTC codes
- SMTP credentials

Pino redact rules already cover the basics. Extend for new sensitive fields.

Redaction is defence in depth, not the last line. A field that is redacted at
the pino layer is still visible to any code that touches the object before it
reaches the logger — for example, a DTO that gets serialised into a Sentry
`extra` field. Treat redaction paths as a safety net, and treat the source DTO
as untrusted: hash or truncate at construction time when possible.

When a new sensitive field is introduced:
1. Add its path to the `redact` array in `logger.module.ts`
2. Add a test that logs a fixture containing the field and asserts the output
   does not include the raw value
3. Review every place the DTO is passed to `captureException` or to
   third-party SDKs (analytics, CRM, etc.)

## Debug Session Workflow
1. User reports bug → get approximate timestamp + user telegramId
2. `curl logs | jq 'select(.userId == "<id>" and .time > "<ts>")'`
3. Find Sentry event via time + user tag
4. Attach correlation ID from log to Sentry event for cross-link
5. Reproduce locally with env var `LOG_LEVEL=debug`

The correlation ID is the pivot. Every request carries one in the
`X-Request-Id` response header, so the first question to a user reporting a
bug is "can you share the request ID from the failing response?" If the
frontend surfaces it (for example, in an error toast), the debug session
skips step 2 entirely — go straight from the ID to the logs and the Sentry
event.

For longer investigations, pull the relevant logs into a local file and
replay them through `jq` filters. Keep the raw JSON — never strip it to
pretty-print — so subsequent filters can narrow further.

## Runbook Index

Each alert in the table above should link to a runbook. Maintain these in
`backend/docs/runbooks/` (create the directory when the first runbook is
written). A good runbook answers:

- What does this alert mean in plain language?
- What is the expected impact on users?
- What are the first three things to check?
- How is the alert silenced if it turns out to be a false positive?
- What is the remediation for each of the likely root causes?

Runbooks written under duress are always worse than runbooks written
proactively. Take the time to draft one when you *design* the alert, not when
it fires for the first time.
