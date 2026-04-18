<div align="center">

# 🔧 Work Tact Backend

**NestJS backend + Telegram bot for Work Tact — time tracking via QR codes and messaging**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)

</div>

---

## About

<sub>PRODUCT NAME: WORK TACT · REPO: `World-Time-back-End`</sub>

Work Tact Backend is the core service powering the Work Tact platform — a time tracking product that bridges B2B office attendance (via rotating QR codes anchored to company coordinates) and B2C freelance time tracking (via Telegram-driven start/stop timers and projects). It handles every server-side concern of the product: Telegram-based authentication, company and employee lifecycle management, check-ins with cryptographically rotating QR tokens, time entries for freelancers, analytics (lateness, overtime, punctuality, real hourly rate), exports to Google Sheets, PDF attendance reports and freelance invoices, a platform-wide admin panel, and tier-based billing with seat limits.

The service is fully typed end-to-end (TypeScript + Prisma generated types + Zod DTOs), thoroughly tested (Jest unit tests + Supertest e2e), containerized as a multi-stage non-root Docker image, and observable out of the box (Pino structured logs, Sentry error tracking, Terminus health probes, Swagger/OpenAPI). It is designed to run behind an nginx reverse proxy in production and ships with a docker-compose stack (Postgres, Redis, backend, worker) plus a Telegram bot process embedded in the same NestJS application via `nestjs-telegraf`.

## Features

- 🔐 **Telegram Auth** — Bot-issued 6-digit codes + Telegram Login Widget verification with HMAC signature check
- 🔄 **Rotating QR** — HMAC-signed tokens, 30s rotation, 45s TTL, anti-replay via Redis nonce cache
- 📍 **Geofencing** — Haversine distance check on check-in against company coordinates with configurable radius
- 🤖 **Telegram Bot** — nestjs-telegraf handlers: `/start`, `/checkin`, `/projects`, `/timer`, `/stats` with inline keyboards
- 📊 **Analytics** — Lateness, overtime, punctuality ranking, real hourly rate, month-over-month trends
- 📑 **Sheets Export** — Google Sheets API integration for monthly attendance with shared drive support
- 📄 **PDF Reports** — Attendance reports + freelance invoices via `pdfkit` with brand-customized templates
- 📧 **Email Notifications** — Transactional emails via nodemailer (invites, reports ready, billing alerts)
- 👑 **Admin Panel** — Cross-company operations for platform super-admins (impersonation, audits, overrides)
- 💳 **Billing Tiers** — FREE / TEAM / ENTERPRISE with seat limit enforcement via guard + webhook hooks
- 🏥 **Health Checks** — `/healthz/live` and `/healthz/ready` powered by `@nestjs/terminus`
- 🔭 **Observability** — Pino structured logs, Sentry error tracking, Swagger UI at `/api/docs`
- 🛡️ **Security** — Helmet, per-user rate limiting, JWT access + refresh, strict CSP headers
- ⚡ **Performance** — Redis caching & sessions, request compression, Prisma connection pooling
- 🧪 **Type Safety** — End-to-end TypeScript, Zod runtime validation, generated Prisma models
- 🗓️ **Scheduled Jobs** — `@nestjs/schedule` cron workers for monthly exports, token cleanup, digests
- 🌐 **i18n Ready** — Timezone-aware timestamps, localized bot messages, Kazakhstan-first defaults

## Tech Stack

**Core**

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 |
| Language | TypeScript 5.6 |
| Database | PostgreSQL 16 + Prisma 5 |
| Cache/Sessions | Redis 7 + ioredis |
| Telegram | nestjs-telegraf + Telegraf 4 |

**Tooling**

| Layer | Technology |
|-------|-----------|
| Auth | `@nestjs/jwt`, `passport-jwt` |
| Validation | Zod via `nestjs-zod` |
| Rate Limit | `@nestjs/throttler` |
| Logging | `nestjs-pino` |
| Errors | `@sentry/nestjs` |
| Docs | `@nestjs/swagger` |
| PDF | `pdfkit` |
| Email | `nodemailer` |
| Sheets | `googleapis` |
| Queue | `@nestjs/schedule` (cron) |

**Testing & CI**

| Layer | Technology |
|-------|-----------|
| Unit | Jest + `ts-jest` |
| E2E | Supertest |
| Lint | ESLint + Prettier |
| Hooks | Husky + lint-staged + commitlint |
| CI | GitHub Actions |
| Container | Docker multi-stage + non-root |

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| Auth | `src/modules/auth` | Telegram verify, bot OTC, JWT issue/refresh |
| Company | `src/modules/company` | Create company, invite employees |
| Employee | `src/modules/employee` | Per-employee views, accept invites |
| Checkin | `src/modules/checkin` | Rotating QR, check-in scan, SSE stream |
| Project | `src/modules/project` | B2C projects CRUD + monthly summary |
| TimeEntry | `src/modules/time-entry` | Start/stop/list time entries |
| Telegram | `src/modules/telegram` | Bot handlers, keyboards, session |
| Analytics | `src/modules/analytics` | Lateness, overtime, ranking, real rate |
| Sheets | `src/modules/sheets` | Google Sheets export |
| Report | `src/modules/report` | PDF attendance + invoice |
| Notification | `src/modules/notification` | Email via nodemailer |
| Admin | `src/modules/admin` | Platform super-admin ops |
| Billing | `src/modules/billing` | Tier matrix + seat limit guard |
| Health | `src/modules/health` | Liveness + readiness probes |

## API Overview

The HTTP API is mounted under the `/api` global prefix. In local development the base URL is:

```
http://localhost:4000/api
```

All protected routes require a `Authorization: Bearer <JWT>` header. Access tokens are short-lived (15 minutes) and paired with a long-lived refresh token issued on login. Swagger UI with full schema, try-it-out, and auth flow is available at:

```
http://localhost:4000/api/docs
```

**Example — request a bot-issued one-time code:**

```sh
curl -X POST http://localhost:4000/api/auth/telegram/bot-login \
  -H "Content-Type: application/json" \
  -d '{"telegramId": 123456789}'
```

**Example — scan a rotating QR:**

```sh
curl -X POST http://localhost:4000/api/checkin/scan \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token": "<rotating-qr-token>", "lat": 51.128, "lng": 71.430}'
```

## Project Structure

```
backend/
├── src/
│   ├── main.ts                # App bootstrap, global pipes/filters
│   ├── app.module.ts          # Root module composition
│   ├── instrument.ts          # Sentry init (loaded before Nest)
│   ├── common/                # Cross-cutting (prisma, redis, logger, guards, filters)
│   └── modules/               # 15 feature modules (see table above)
├── test/                      # Jest e2e + setup
├── prisma/                    # (schema lives in @worktime/database)
├── Dockerfile                 # Multi-stage, non-root
├── jest.config.ts
├── jest-e2e.config.ts
└── package.json
```

## Getting Started

```sh
# Clone (mirror repo — for full workspace clone the Work Tact monorepo)
git clone https://github.com/foxnaim/World-Time-back-End.git
cd World-Time-back-End

# Install
pnpm install

# Env
cp .env.example .env   # set DATABASE_URL, TELEGRAM_BOT_TOKEN, JWT_SECRET, QR_HMAC_SECRET

# Database
pnpm --filter @worktime/database db:push
pnpm --filter @worktime/database db:seed

# Run
pnpm dev
```

Open [http://localhost:4000/api/docs](http://localhost:4000/api/docs) to explore the Swagger UI.

> **Note:** this package depends on `@worktime/database`, `@worktime/types`, and `@worktime/config` via `workspace:*`. To run standalone, either clone the full monorepo, publish those packages to a private registry, or inline them locally. See `docs/adr/0003-monorepo-structure.md` in the monorepo for context.

## Environment Variables

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `REDIS_URL` | yes | — | Redis connection string (sessions + OTC cache) |
| `TELEGRAM_BOT_TOKEN` | yes | — | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | yes | — | Bot username (no `@`) for Login Widget |
| `JWT_SECRET` | yes | — | HS256 secret for access tokens |
| `JWT_REFRESH_SECRET` | yes | — | HS256 secret for refresh tokens |
| `QR_HMAC_SECRET` | yes | — | HMAC key used to sign rotating QR payloads |
| `SMTP_HOST` | no | — | SMTP server host for transactional email |
| `SMTP_PORT` | no | `587` | SMTP server port |
| `SMTP_USER` | no | — | SMTP username |
| `SMTP_PASS` | no | — | SMTP password |
| `SENTRY_DSN` | no | — | Sentry DSN (enables error tracking when set) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | no | — | JSON service account for Sheets export |
| `SUPER_ADMIN_TELEGRAM_IDS` | no | — | Comma-separated Telegram IDs granted super-admin |
| `API_PORT` | no | `4000` | HTTP port the app listens on |
| `WEB_URL` | yes | — | Public URL of the frontend (for CORS + email links) |

## Testing

```sh
pnpm test            # unit tests
pnpm test:cov        # unit tests with coverage
pnpm test:e2e        # integration tests (requires running Postgres + Redis)
```

The e2e suite boots a real Nest application against a disposable database — run `docker compose up -d postgres redis` at the monorepo root before invoking `pnpm test:e2e`.

## Docker

```sh
# Build from monorepo root as context (workspace packages resolve correctly)
docker build -f Dockerfile -t worktime-backend ..

# Or via compose at monorepo root (Postgres + Redis + backend + worker)
docker compose up -d
```

The Dockerfile is multi-stage: a `deps` stage installs with pnpm, a `build` stage compiles TypeScript, and a slim `runner` stage copies `dist/` and runs as a non-root `node` user with `NODE_ENV=production`.

## Deployment

The backend runs anywhere Node 20 + Postgres + Redis are available. Recommended targets:

- **Railway / Render / Fly.io** — point at the Dockerfile, set env vars, attach managed Postgres + Redis
- **VPS (Hetzner, DO, etc.)** — `docker-compose.prod.yml` + nginx reverse proxy; TLS via certbot. Sample nginx config lives at `nginx/sites-enabled/worktime.conf` in the monorepo.
- **Kubernetes** — Helm chart in `deploy/helm/` (monorepo) with separate `api` and `worker` deployments

Before shipping to production, walk through `docs/SECURITY_CHECKLIST.md` — it covers secret rotation, Telegram webhook hardening, rate limit tuning, and Sentry sampling.

## Telegram Bot Setup

1. Create the bot via [@BotFather](https://t.me/BotFather) and copy the token into `TELEGRAM_BOT_TOKEN`
2. Set the bot username in `TELEGRAM_BOT_USERNAME` (without the `@`)
3. Configure your production domain via `/setdomain` so the Telegram Login Widget accepts it
4. Register the command list via `/setcommands`:
   ```
   start - Start the bot / register
   auth - Link your Telegram to Work Tact
   checkin - Scan a rotating QR for office check-in
   projects - List your freelance projects
   timer - Start or stop a time entry
   stats - Monthly summary
   ```
5. (Optional) Set a webhook URL via `/setwebhook` — leave unset to use long polling

## Links

- Frontend: [World-Time-Frontend](https://github.com/foxnaim/World-Time-Frontend)
- Monorepo (full workspace): [foxnaim/WorkTime](https://github.com/foxnaim/WorkTime)
- API docs (local): [http://localhost:4000/api/docs](http://localhost:4000/api/docs)

## License

MIT © [foxnaim](https://github.com/foxnaim)
