# World-Time-back-End

NestJS backend + Telegram bot for WorkTime — QR-based time tracking for B2B offices and B2C freelancers.

## Stack

- NestJS 10 + TypeScript
- Prisma 5 + PostgreSQL 16
- Redis 7 (sessions, OTC)
- Telegraf (`nestjs-telegraf`) — Telegram bot
- Pino structured logs, Sentry, Helmet, Compression
- Swagger / OpenAPI at `/api/docs`

## Modules

`auth`, `company`, `employee`, `checkin` (rotating QR), `project`, `time-entry`, `telegram` (bot), `analytics`, `sheets` (Google Sheets export), `report` (PDF), `notification` (email), `admin`, `billing`, `health`.

## Run (local)

```sh
pnpm install
cp ../.env.example .env
docker compose -f ../docker-compose.yml up -d   # postgres + redis
pnpm db:generate && pnpm db:push && pnpm db:seed
pnpm dev
```

> **Note:** this package depends on `@worktime/database`, `@worktime/types`, `@worktime/config` via `workspace:*`. To run standalone, either clone the full monorepo, publish those packages, or inline them locally. See `docs/adr/0003-monorepo-structure.md` in the monorepo.

## Docker

```sh
docker build -f Dockerfile -t worktime-backend ..
```

(Build context is the monorepo root.)

## Env

See `.env.example` in the monorepo root.
