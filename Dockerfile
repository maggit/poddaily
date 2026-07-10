# syntax=docker/dockerfile:1
# One image for all three poddaily processes. The entrypoint picks the role from the
# container command: `web` (default, Next.js standalone), `api` (Slack Bolt inbound),
# `worker` (BullMQ scheduler + outbound DM) — see docker-entrypoint.sh. api and worker
# are esbuild-bundled to self-contained ESM files, so the final image carries no
# node_modules beyond what Next's standalone tracer emits.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Copy EVERY workspace package.json so the frozen lockfile fully resolves.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/slack-client/package.json packages/slack-client/package.json
COPY tools/slack-stub/package.json tools/slack-stub/package.json
RUN pnpm install --frozen-lockfile

FROM base AS build
# Per-package node_modules from the install stage: pnpm symlinks each workspace
# package's deps under <pkg>/node_modules, and esbuild/Next resolve through them.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
# Dummy DATABASE_URL so the DB singleton import doesn't throw; build does not query the DB.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @poddaily/web build
# Bundle the non-Next processes (and the migration runner + worker healthcheck probe)
# into self-contained ESM files. The createRequire banner lets CJS deps that use dynamic
# require (inside bullmq/bolt) work from an ESM bundle.
RUN mkdir -p dist && for entry in apps/api/src/index.ts:api apps/worker/src/index.ts:worker \
      apps/worker/src/healthcheck.ts:healthcheck packages/db/scripts/migrate.ts:migrate; do \
      apps/web/node_modules/.bin/esbuild "${entry%%:*}" --bundle --platform=node --format=esm \
        --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
        --outfile="dist/${entry##*:}.mjs" || exit 1; \
    done

FROM node:22-alpine AS runner
ARG APP_VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/maggit/poddaily" \
      org.opencontainers.image.description="Self-hosted, Slack-native daily standup bot" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_VERSION=$APP_VERSION
# Next standalone reads HOSTNAME; Docker sets it to the container hostname, which would
# make the server bind to that name instead of all interfaces → unreachable behind the
# proxy (502). Force 0.0.0.0 so it listens on every interface.
ENV HOSTNAME=0.0.0.0
ENV MIGRATIONS_DIR=/app/migrations
# Next standalone output (monorepo: server.js is nested under apps/web)
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/packages/db/migrations ./migrations
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER node
# web listens on 3000, api on 3001 (defaults set per-role in the entrypoint)
EXPOSE 3000 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["web"]
