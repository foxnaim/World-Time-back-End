# Deployment

Work Tact is container-first. Deploy backend + frontend separately or use the bundled `docker-compose.prod.yml` + nginx config.

This guide walks through production-grade deploys across the most common targets: a self-hosted VPS (the cheapest and most flexible path), Railway (lowest operational overhead), Fly.io (edge-friendly), Render, AWS ECS Fargate (enterprise-scale), and Vercel (frontend only). Pick the row in the matrix that matches your team's budget, scale, and tolerance for ops work — the rest of this document assumes you've picked one.

## Deployment Options Matrix

| Target | Backend | Frontend | Effort | Cost | Notes |
|--------|---------|----------|--------|------|-------|
| Self-hosted VPS (Hetzner, DO) | Docker + nginx | Docker behind same nginx | Medium | $6+/mo | `docker-compose.prod.yml` included |
| Railway | Docker | Docker or native | Low | $5-20/mo | Great for MVP |
| Fly.io | Docker multi-region | Docker | Medium | Pay-as-you-go | Edge-friendly |
| Render | Docker | Native Next.js | Low | $7+/mo | Simple UI |
| AWS ECS Fargate | Docker | Docker | High | Variable | Enterprise scale |
| Vercel | — | Native | Trivial | Free→Pro | **Frontend only** — backend must live elsewhere |

### How to pick
- **Solo / early MVP** → Railway. You get Postgres, Redis, and zero-config Docker in minutes.
- **Pre-seed / cost-sensitive** → Self-hosted VPS (Hetzner CX22 at ~6 EUR/mo runs the full stack comfortably).
- **Global audience / <100ms latency everywhere** → Fly.io with multi-region Postgres.
- **Enterprise compliance (SOC2, HIPAA)** → AWS ECS Fargate or GCP Cloud Run with customer-managed KMS.
- **Frontend polish team, happy to outsource backend ops** → Vercel for FE + Railway/Fly for BE.

---

## Option A: Self-hosted VPS (recommended starter)

### 1. Prerequisites
- Ubuntu 24.04 VPS (>= 2 vCPU, 4 GB RAM)
- Domain pointing A-record to VPS (e.g. `api.your-domain.kz`, `your-domain.kz`)
- Installed: docker, docker-compose v2, ufw, certbot

Firewall baseline:
```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Create a non-root deploy user and add them to the `docker` group. Never run `docker compose up` as root in production.

### 2. Clone + configure
```sh
git clone https://github.com/foxnaim/WorkTime.git   # or mirror repos
cd WorkTime
cp .env.prod.example .env.prod
vi .env.prod   # set all secrets
```

Critical secrets to fill in `.env.prod`:
- `DATABASE_URL` (Postgres, TLS required)
- `REDIS_URL`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `QR_HMAC_SECRET` (each >= 32 bytes)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `SENTRY_DSN`
- `WEB_URL`, `API_URL`

Generate secrets with:
```sh
openssl rand -base64 48
```

### 3. TLS certs
Obtain certs via Let's Encrypt and bind-mount into nginx:
```sh
sudo certbot certonly --standalone -d your-domain.kz -d api.your-domain.kz
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/your-domain.kz/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/your-domain.kz/privkey.pem nginx/certs/
sudo chown -R $USER:$USER nginx/certs
```

If ports 80/443 are already bound by another service, use `--webroot` mode instead of `--standalone`.

### 4. Bring up the stack
```sh
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile migrate run --rm migrator
```

The `migrator` service runs Prisma migrations once and exits. Always run it **after** the new image is up but before you point traffic at it.

### 5. Verify
- `curl https://api.your-domain.kz/api/healthz/live` -> `{ "status": "ok" }`
- `curl https://api.your-domain.kz/api/healthz/ready` -> `{ "db": "ok", "redis": "ok" }`
- Open `https://your-domain.kz/` — landing should render
- Telegram bot should respond to `/start`

### 6. Cert renewal (cron)
```sh
0 3 * * * certbot renew --post-hook "docker compose -f /opt/worktime/docker-compose.prod.yml restart nginx"
```

Let's Encrypt certs expire every 90 days; the renewal hook restarts nginx so the new cert is picked up immediately.

### 7. Backups
```sh
# /etc/cron.daily/worktime-db-backup
docker compose -f /opt/worktime/docker-compose.prod.yml exec -T postgres \
  pg_dump -U $POSTGRES_USER $POSTGRES_DB | \
  gzip > /var/backups/worktime/db-$(date +%F).sql.gz
find /var/backups/worktime -mtime +14 -delete
```

Ship backups off-box (S3, Backblaze B2, or rsync to a second VPS).

---

## Option B: Railway (simplest)

### Backend
1. Railway -> New Project -> Deploy from GitHub -> select World-Time-back-End
2. Add Postgres plugin -> auto-injects `DATABASE_URL`
3. Add Redis plugin -> auto-injects `REDIS_URL`
4. Env vars: `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `QR_HMAC_SECRET`, `WEB_URL`
5. Build command: handled by Dockerfile
6. Start command: handled by Dockerfile CMD
7. Custom domain -> `api.your-domain.kz`

### Frontend
1. Railway -> Deploy from GitHub -> World-Time-Frontend
2. Env vars: `NEXT_PUBLIC_API_URL=https://api.your-domain.kz`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BOT_USERNAME`, `JWT_PUBLIC_SECRET` (same as backend `JWT_SECRET`)
3. Custom domain -> `your-domain.kz`

### Pitfall
Railway builds each repo standalone — `workspace:*` deps fail. Fix by either:
- Copying `packages/*` into each repo before Railway reads it
- Or deploying the full monorepo (single Railway service per app) — better

### Migrations on Railway
Railway does not have a `run --rm` equivalent for one-off jobs. Options:
- Add a `release` step in `railway.toml` that runs `pnpm prisma migrate deploy` before boot
- Or run migrations manually: `railway run pnpm prisma migrate deploy`

---

## Option C: Fly.io

Frontend and backend each get their own `fly.toml`. Postgres via `fly postgres create`. Redis via Upstash (`fly redis create`).

```sh
cd backend/ && fly launch --copy-config --no-deploy
cd frontend/ && fly launch --copy-config --no-deploy
```

Edit fly.toml for each:
- backend: port 4000, env keys, healthcheck `/api/healthz/live`
- frontend: port 3000, healthcheck `/api/health`

Minimum `fly.toml` for backend:
```toml
app = "worktime-api"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 4000
  force_https = true
  auto_start_machines = true
  auto_stop_machines = true

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/api/healthz/live"
  timeout = "5s"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

Deploy:
```sh
fly deploy -c backend/fly.toml
fly deploy -c frontend/fly.toml
```

Set secrets without baking them into the image:
```sh
fly secrets set JWT_SECRET=... TELEGRAM_BOT_TOKEN=... -a worktime-api
```

### Multi-region
Fly will replicate app machines automatically when you `fly scale count 3 --region fra,ams,sin`. Pair with a read-replica Postgres cluster; writes still go to the primary region.

---

## Option D: Render

Render auto-detects the Dockerfile in both repos. Create two services:
1. **Web Service (backend)** — Docker, port 4000, healthcheck `/api/healthz/live`
2. **Web Service (frontend)** — native Next.js, build `pnpm build`, start `pnpm start`

Add a Render managed Postgres + a Render managed Redis. Inject `DATABASE_URL` and `REDIS_URL` into the backend service. Register migrations under "Pre-deploy command": `pnpm prisma migrate deploy`.

---

## Option E: AWS ECS Fargate (enterprise)

Outline — full IaC out of scope for this doc:
1. Build + push images to ECR: `backend/Dockerfile`, `frontend/Dockerfile`
2. Create an RDS Postgres (Multi-AZ) and ElastiCache Redis
3. Define ECS task definitions (one per service) with secrets from AWS Secrets Manager
4. Put both services behind an ALB; path-based routing (`/api/*` -> backend, `/*` -> frontend)
5. Route53 for DNS, ACM for TLS
6. CloudWatch Logs for stdout, CloudWatch Alarms for health
7. Run migrations via a one-shot ECS task kicked off in CodePipeline before the new task version rolls out

Cost: ~$150-300/mo for a minimal HA setup. Prefer Fargate Spot for worker tasks.

---

## Option F: Vercel (frontend only)

Connect `World-Time-Frontend` repo. Set env vars. Deploy.

Env vars to set in the Vercel project dashboard:
- `NEXT_PUBLIC_API_URL=https://api.your-domain.kz`
- `NEXT_PUBLIC_APP_URL=https://your-domain.kz`
- `NEXT_PUBLIC_BOT_USERNAME=YourBot`
- `JWT_PUBLIC_SECRET` (matches backend `JWT_SECRET`)

Backend must live elsewhere (Railway, Fly, self-hosted). Vercel has no long-running container suitable for our Telegram bot + Redis queue worker.

---

## Telegram Bot Webhook

For prod, switch bot from long-polling to webhook:
```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://api.your-domain.kz/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Verify the webhook is registered:
```sh
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

If you need to revert to long-polling (e.g. during an incident):
```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```

The backend verifies every incoming webhook request against `TELEGRAM_WEBHOOK_SECRET` in the `X-Telegram-Bot-Api-Secret-Token` header — rotate that secret when you rotate the bot token.

---

## Rollback Strategy

- Tag every release: `git tag -a v1.2.3 -m "..."` -> triggers `docker.yml` workflow -> pushes GHCR image
- Rollback: `docker compose pull` with previous tag + restart
- DB: forward-only migrations; revert by new migration

Concrete rollback playbook (VPS/Compose):
```sh
# 1. Pin to previous tag in .env.prod
sed -i 's/IMAGE_TAG=v1.2.3/IMAGE_TAG=v1.2.2/' .env.prod

# 2. Pull + restart just the app services (NOT the DB)
docker compose -f docker-compose.prod.yml pull backend frontend
docker compose -f docker-compose.prod.yml up -d backend frontend

# 3. Confirm
curl https://api.your-domain.kz/api/healthz/ready
```

**Never roll back the database.** If a forward migration broke production, write a new forward migration that undoes the damage. This keeps migration history linear and avoids divergent schemas across environments.

---

## Zero-Downtime Deploys

The compose stack uses nginx in front of two app replicas. A deploy follows:
1. `docker compose pull backend`
2. `docker compose up -d --no-deps --scale backend=2 backend`
3. nginx (with `proxy_next_upstream`) drains old container
4. `docker compose up -d --no-deps --scale backend=1 backend`

Frontend rolls the same way. Migrations run **before** the new code is live; make schema changes additive (add column -> dual-write -> backfill -> drop old column across two releases).

---

## Post-deploy Checklist

See `docs/SECURITY_CHECKLIST.md`. TL;DR:
- [ ] All secrets 32+ bytes
- [ ] `DATABASE_URL` uses TLS
- [ ] Sentry DSN wired
- [ ] pgAdmin/redis-commander NOT exposed
- [ ] Backups scheduled
- [ ] Log aggregation (Loki / Datadog / CloudWatch)
- [ ] Uptime monitor (BetterUptime, UptimeRobot)
- [ ] Telegram webhook secret rotated
- [ ] Rate limits on `/api/auth/*` verified
- [ ] CORS origins locked to production domain(s)
- [ ] CSP headers present on frontend

---

## Monitoring & Alerts

- `/api/healthz/ready` — hook to uptime monitor
- Sentry — error tracking
- Log drains — forward Pino JSON to aggregator
- Alerts: uptime < 99%, error rate spike, DB connection pool saturation

### Recommended alerting thresholds
| Signal | Warning | Critical |
|--------|---------|----------|
| `/api/healthz/ready` failing | 2 consecutive | 5 consecutive |
| p95 latency | > 500ms | > 1500ms |
| 5xx error rate | > 1% | > 5% |
| DB pool utilization | > 70% | > 90% |
| Redis memory | > 75% | > 90% |
| Disk free on VPS | < 20% | < 10% |

### Dashboards
At a minimum, build one dashboard per layer:
- **Edge** — nginx req/s, 2xx/4xx/5xx split, upstream latency
- **App** — request rate, p50/p95/p99, error rate, active sessions
- **DB** — connections, transaction rate, slow queries, replication lag
- **Queue (BullMQ)** — jobs waiting, active, failed, processing time

Grafana + Prometheus + Loki is the standard free stack; Datadog if you have the budget and want it "just working."

---

## Environment Promotion

Keep three environments: `dev` (local), `staging` (deployed, non-public), `prod`. Promote by git tags:
- `main` auto-deploys to staging
- `v*.*.*` tags auto-deploy to prod

Both environments should use identical infrastructure topology. Differences between staging and prod are the single largest source of "it worked in staging" incidents — resist the urge to skip Redis or run a SQLite DB in staging.

---

## Disaster Recovery

Document and drill **at least once per quarter**:
1. Restore latest DB backup onto a scratch instance
2. Point staging backend at the restored DB
3. Walk through a smoke-test scenario (login, create entry, generate QR)
4. Record time-to-recover; target RTO < 1 hour, RPO < 24 hours

Store runbooks in `docs/RUNBOOKS/` — one per failure mode (DB down, Redis down, bot token leaked, etc.).
