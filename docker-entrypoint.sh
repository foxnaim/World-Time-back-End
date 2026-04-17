#!/bin/sh
# docker-entrypoint.sh — WorkTime API container entrypoint.
#
# Make sure this file is executable before building the image:
#     chmod +x backend/docker-entrypoint.sh
#
# Responsibilities:
#   1. Wait for the database TCP port to accept connections (no psql client
#      needed — uses `nc -z` in a simple loop, mimicking `pg_isready`).
#   2. Apply any pending Prisma migrations using the schema that ships inside
#      the deployed database package.
#   3. exec the container's CMD (typically `node dist/main.js`) so signals
#      propagate to PID 1 (tini) correctly.

set -eu

log() {
    printf '[entrypoint] %s\n' "$*"
}

###############################################################################
# 1. Wait for the database
###############################################################################
# DB_HOST / DB_PORT can be provided explicitly; otherwise we try to parse them
# from DATABASE_URL (postgres://user:pass@host:port/db?...).
DB_HOST="${DB_HOST:-}"
DB_PORT="${DB_PORT:-}"

if [ -z "${DB_HOST}" ] || [ -z "${DB_PORT}" ]; then
    if [ -n "${DATABASE_URL:-}" ]; then
        # Strip scheme + optional credentials, then split host:port/...
        _hostport="${DATABASE_URL#*://}"
        _hostport="${_hostport#*@}"
        _hostport="${_hostport%%/*}"
        _hostport="${_hostport%%\?*}"
        DB_HOST="${DB_HOST:-${_hostport%%:*}}"
        _maybe_port="${_hostport#*:}"
        if [ "${_maybe_port}" != "${_hostport}" ]; then
            DB_PORT="${DB_PORT:-${_maybe_port}}"
        fi
    fi
fi

DB_PORT="${DB_PORT:-5432}"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"

if [ -n "${DB_HOST}" ]; then
    log "Waiting for database at ${DB_HOST}:${DB_PORT} (timeout ${DB_WAIT_TIMEOUT}s)..."
    _waited=0
    until nc -z "${DB_HOST}" "${DB_PORT}" 2>/dev/null; do
        if [ "${_waited}" -ge "${DB_WAIT_TIMEOUT}" ]; then
            log "ERROR: database at ${DB_HOST}:${DB_PORT} not reachable after ${DB_WAIT_TIMEOUT}s"
            exit 1
        fi
        _waited=$((_waited + 1))
        sleep 1
    done
    log "Database is accepting connections after ${_waited}s."
else
    log "No DB_HOST / DATABASE_URL provided; skipping DB wait."
fi

###############################################################################
# 2. Apply pending migrations
###############################################################################
# The build stage deploys the schema to /app/packages/database/prisma/schema.prisma.
PRISMA_SCHEMA="${PRISMA_SCHEMA:-/app/packages/database/prisma/schema.prisma}"

if [ "${DB_MIGRATE:-1}" = "1" ] && [ -n "${DATABASE_URL:-}" ]; then
    if [ -f "${PRISMA_SCHEMA}" ]; then
        log "Running 'prisma migrate deploy' against ${PRISMA_SCHEMA}..."
        npx --yes prisma migrate deploy --schema="${PRISMA_SCHEMA}"
        log "Migrations complete."
    else
        log "WARNING: Prisma schema not found at ${PRISMA_SCHEMA}; skipping migrations."
    fi
else
    log "Skipping migrations (DB_MIGRATE=${DB_MIGRATE:-1}, DATABASE_URL=${DATABASE_URL:+set})."
fi

###############################################################################
# 3. Hand off to the container's CMD
###############################################################################
log "Starting application: $*"
exec "$@"
