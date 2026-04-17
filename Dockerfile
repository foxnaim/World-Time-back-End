# syntax=docker/dockerfile:1.7
#
# WorkTime API — multi-stage production image for a pnpm + Turborepo monorepo.
#
# Build context MUST be the monorepo root, e.g.:
#     docker build -f backend/Dockerfile -t worktime/api .
#
# The final image runs the compiled NestJS server as the unprivileged `node`
# user on port 4000.

###############################################################################
# Stage 1: base — pinned Node + pnpm toolchain shared by later stages.
###############################################################################
FROM node:22-alpine AS base

# Native-module prerequisites (prisma engines, bcrypt, etc.).
RUN apk add --no-cache libc6-compat openssl

# Enable corepack and pin pnpm to match the monorepo's packageManager field.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

ENV CI=1 \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH

###############################################################################
# Stage 2: deps — install the full workspace dependency graph.
#
# Only the workspace manifests + lockfile are copied first so this layer
# invalidates only when a package.json / lockfile changes, keeping the
# expensive install step cacheable across source-only rebuilds.
###############################################################################
FROM base AS deps

# Root workspace config + lockfile (lockfile is optional during bootstrap).
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY pnpm-lock.yaml* ./

# Per-workspace manifests — listed explicitly so the deps layer stays
# deterministic and cache-friendly.
COPY backend/package.json            ./backend/package.json
COPY packages/config/package.json    ./packages/config/package.json
COPY packages/database/package.json  ./packages/database/package.json
COPY packages/types/package.json     ./packages/types/package.json
COPY packages/ui/package.json        ./packages/ui/package.json

# Install. Prefer a frozen install when the lockfile is present; otherwise
# fall back to a mutable install so the image can be built before the
# lockfile has been committed.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        pnpm install; \
    fi

###############################################################################
# Stage 3: build — copy sources, generate Prisma client, compile NestJS.
###############################################################################
FROM base AS build

# Bring over the fully installed workspace (node_modules + manifests).
COPY --from=deps /repo /repo

# Copy source trees for the backend and every internal package it depends on.
COPY backend/            ./backend/
COPY packages/config/    ./packages/config/
COPY packages/database/  ./packages/database/
COPY packages/types/     ./packages/types/
COPY packages/ui/        ./packages/ui/

# 1) Generate the Prisma client against the schema in packages/database.
# 2) Compile the NestJS application to backend/dist.
RUN pnpm --filter @worktime/database generate \
 && npx --prefix /repo/packages/database prisma generate --schema=/repo/packages/database/prisma/schema.prisma \
 && pnpm --filter @worktime/api build

# Prune dev dependencies so only production deps remain in node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --ignore-scripts \
        --filter @worktime/api... \
        --filter @worktime/database \
        --filter @worktime/types

###############################################################################
# Stage 4: runtime — minimal image that runs the compiled app.
###############################################################################
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    PATH=/root/.local/share/pnpm:$PATH

# wget for HEALTHCHECK, openssl + libc6-compat for Prisma engines,
# tini for clean PID 1 signal handling.
RUN apk add --no-cache wget openssl libc6-compat tini \
 && corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Root workspace metadata (keeps workspace resolution intact at runtime).
COPY --from=build --chown=node:node /repo/package.json         ./package.json
COPY --from=build --chown=node:node /repo/pnpm-workspace.yaml  ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /repo/node_modules         ./node_modules

# Compiled backend + its manifest.
COPY --from=build --chown=node:node /repo/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /repo/backend/dist         ./backend/dist
COPY --from=build --chown=node:node /repo/backend/node_modules ./backend/node_modules

# Internal packages — ship sources that Node can resolve at runtime, the
# generated Prisma client, and any compiled dist output that may exist.
COPY --from=build --chown=node:node /repo/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /repo/packages/database/src          ./packages/database/src
COPY --from=build --chown=node:node /repo/packages/database/prisma       ./packages/database/prisma
COPY --from=build --chown=node:node /repo/packages/database/node_modules ./packages/database/node_modules

COPY --from=build --chown=node:node /repo/packages/types/package.json ./packages/types/package.json
COPY --from=build --chown=node:node /repo/packages/types/src          ./packages/types/src

# Entrypoint (migrations, readiness checks). Expected to exist at
# backend/docker-entrypoint.sh in the repo and be executable.
COPY --from=build --chown=node:node /repo/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --spider http://localhost:4000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/main.js"]
