# 2026-07-08 — Unified Docker image, GHCR releases, self-hosting stack

Made the repo production-deployable for self-hosters via published images.

- **Unified `Dockerfile`** replaces `Dockerfile.web/api/worker`: one ~236 MB non-root
  node:22-alpine image; the command picks the role (`web`/`api`/`worker`). `api`/`worker`
  are esbuild-bundled ESM (no tsx/node_modules at runtime).
- **Migrations on boot from every role**, serialized with a Postgres advisory lock
  (`packages/db/scripts/migrate.ts` → `dist/migrate.mjs`), fail-fast.
- **Health:** web `GET /api/health` (DB+Redis+version, middleware-exempt), api
  `GET /health`, worker `dist/healthcheck.mjs`; compose healthchecks on all services.
- **CI/CD:** `.github/workflows/release.yml` (semver tags → ghcr.io/maggit/poddaily,
  amd64+arm64, `X.Y.Z`/`X.Y`/`X`/`latest`), `ci.yml` (PR image build, no push).
- **Self-hosting:** `deploy/docker-compose.yml` (+`.env.example`) pulls GHCR images and
  bundles postgres:18-alpine + redis:7-alpine; guide in root `SELF_HOSTING.md`.
  `docker-compose.dokploy.yml` migrated to the unified Dockerfile (and web gained the
  previously missing `REDIS_URL`/`SLACK_BOT_TOKEN`).

Details: [deployment-docker-image.md](../02_architecture/deployment-docker-image.md).
Verified end-to-end locally: image build, full compose stack boot, migrations applied,
`/api/health` 200 with all checks ok.
