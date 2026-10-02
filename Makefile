## Work Tact developer / ops helper targets.
## Usage: `make <target>`. Run `make help` to list all targets.

# Shell + defaults
SHELL := /bin/sh
.DEFAULT_GOAL := help

# Variables (override: make db-restore FILE=./backups/xxx.sql.gz)
FILE    ?=
SERVICE ?=

# Declare phony targets so they always run.
.PHONY: help install dev dev-backend dev-frontend build lint test test-e2e \
        db-studio db-reset db-backup db-restore \
        docker-build docker-up docker-down docker-logs \
        clean fresh

help: ## Show this help (lists every target with its description).
	@awk 'BEGIN {FS = ":.*?## "; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} \
	     /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- Install / dev ----------

install: ## Install all workspace dependencies via pnpm.
	@pnpm install

dev: ## Start Postgres/Redis, push schema, seed, then run turbo dev (all apps).
	@docker compose up -d
	@pnpm db:push
	@pnpm db:seed
	@pnpm dev

dev-backend: ## Run only the NestJS API in watch mode.
	@pnpm --filter @tact/api dev

dev-frontend: ## Run only the Next.js web app in dev mode.
	@pnpm --filter @tact/web dev

# ---------- Build / quality ----------

build: ## Build every workspace package (turbo build).
	@pnpm build

lint: ## Lint every workspace and format the Prisma schema.
	@pnpm lint
	@pnpm --filter @tact/database exec prisma format

test: ## Run unit tests across the monorepo.
	@pnpm test

test-e2e: ## Run Playwright end-to-end tests against the web app.
	@pnpm --filter @tact/web test:e2e

# ---------- Database ----------

db-studio: ## Open Prisma Studio for the database package.
	@pnpm --filter @tact/database studio

db-reset: ## Wipe Postgres volume, bring it back up, push schema, reseed.
	@docker compose down -v
	@docker compose up -d
	@sleep 5
	@pnpm db:push
	@pnpm db:seed

db-backup: ## Dump Postgres to ./backups/worktime_<ts>.sql.gz.
	@sh scripts/db-backup.sh

db-restore: ## Restore a gzipped dump: make db-restore FILE=./backups/xxx.sql.gz.
	@if [ -z "$(FILE)" ]; then echo "Usage: make db-restore FILE=<path-to-.sql.gz>"; exit 1; fi
	@sh scripts/db-restore.sh "$(FILE)"

# ---------- Production docker ----------

docker-build: ## Build all images from docker-compose.prod.yml.
	@docker compose -f docker-compose.prod.yml build

docker-up: ## Start the production stack in the background.
	@docker compose -f docker-compose.prod.yml up -d

docker-down: ## Stop and remove the production stack.
	@docker compose -f docker-compose.prod.yml down

docker-logs: ## Tail logs: make docker-logs SERVICE=api (omit for all).
	@docker compose -f docker-compose.prod.yml logs -f $(SERVICE)

# ---------- Housekeeping ----------

clean: ## Remove node_modules, dist, .next, and .turbo caches everywhere.
	@rm -rf node_modules
	@find . -type d \( -name node_modules -o -name dist -o -name .next -o -name .turbo \) \
	    -prune -exec rm -rf '{}' +

fresh: ## Nuke caches, reinstall, and start dev from a clean slate.
	@$(MAKE) clean
	@$(MAKE) install
	@$(MAKE) dev
