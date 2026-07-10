# Deployment — unified Docker image & GHCR releases

As of 2026-07-08 poddaily ships **one production image for all three processes**,
replacing the former `Dockerfile.web` / `Dockerfile.api` / `Dockerfile.worker`.

## The image

- Built by the root [`Dockerfile`](../../Dockerfile); published to
  `ghcr.io/maggit/poddaily` (linux/amd64 + linux/arm64, ~236 MB).
- The container **command selects the role** via
  [`docker-entrypoint.sh`](../../docker-entrypoint.sh): `web` (default, Next.js
  standalone on :3000), `api` (Slack Bolt receiver on :3001), `worker` (BullMQ).
- `api` and `worker` are **esbuild-bundled to self-contained ESM files**
  (`dist/api.mjs`, `dist/worker.mjs`) — no `tsx`, no node_modules in the final image.
  Same trick as the pre-existing `migrate.mjs`. A `createRequire` banner keeps CJS
  dynamic requires (inside bullmq/bolt) working.
- Non-root (`node` user), `APP_VERSION` baked in as a build arg from the release tag.

## Migrations

[`packages/db/scripts/migrate.ts`](../../packages/db/scripts/migrate.ts) (bundled to
`dist/migrate.mjs`) runs on **every container start, for every role**, before the
process. Concurrent boots are serialized by a Postgres **session advisory lock**
(key `1886217316`, "podd" in ASCII); the drizzle journal makes re-runs no-ops. It
prefers `DIRECT_URL` (transaction-mode poolers can't hold session locks) and
**fails fast** — a boot with a failed migration exits 1 and lets the restart policy
retry. (Previously the web container started anyway on migration failure.)

## Health

- web: `GET /api/health` → `{ status, version, checks: { database, redis } }`,
  503 when a dependency is down. Excluded from the auth middleware.
- api: `GET /health` → process liveness (Bolt customRoute).
- worker: `node dist/healthcheck.mjs` (DB + Redis probe) as the container healthcheck.

## Releases

Semver git tags (`vX.Y.Z`) trigger
[`.github/workflows/release.yml`](../../.github/workflows/release.yml):
docker/metadata-action derives `X.Y.Z`, `X.Y`, `X`, `latest` tags + OCI labels
(the `org.opencontainers.image.source` label auto-links the GHCR package to the
repo), buildx/QEMU builds both arches, GHA cache speeds rebuilds.
[`ci.yml`](../../.github/workflows/ci.yml) builds the image (no push) on PRs and
pushes to main.

## Consumers

- **Self-hosters:** [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml)
  pulls the GHCR image and bundles `postgres:18-alpine` + `redis:7-alpine`; guide in
  [`SELF_HOSTING.md`](../../SELF_HOSTING.md).
- **poddaily.io (Dokploy):** [`docker-compose.dokploy.yml`](../../docker-compose.dokploy.yml)
  still builds from source but now via the unified Dockerfile (three services, same
  build, different `command`), Postgres external (Supabase). See
  [deployment-dokploy.md](deployment-dokploy.md).
