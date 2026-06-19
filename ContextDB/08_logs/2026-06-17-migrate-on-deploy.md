# 2026-06-17 — Migrate on deploy (web container entrypoint)

Made database migrations run automatically on deploy so they don't have to be hand-run.

## What
The web container's entrypoint (`apps/web/docker-entrypoint.sh`) runs `node migrate.mjs`
**before** starting the Next server. `migrate.mjs` is `apps/web/scripts/migrate.ts` bundled by
esbuild into a single dependency-free ESM file (uses drizzle's runtime
`drizzle-orm/postgres-js/migrator`, not drizzle-kit, so the minimal standalone runner needs no
extra tooling). `Dockerfile.web` copies `packages/db/migrations` + `migrate.mjs` + the
entrypoint into the runner; `CMD` is now the entrypoint.

Migration target: `DIRECT_URL` (Supabase **session pooler**, 5432) when set, else `DATABASE_URL`.
Idempotent (drizzle tracks applied migrations) and **non-blocking** — a failed migration logs a
warning and the server starts anyway (single web replica; `/login` stays up, failure visible in
logs).

## Verified
- `docker build -f Dockerfile.web` succeeds.
- Container run against a **fresh empty DB** → logs `[migrate] schema up to date` →
  `[entrypoint] starting server`; `\dt` shows all 7 tables created; `/login` → 200.
- `pnpm test`: 26 pass.

## Notable
- `drizzle-orm` + `postgres` added as direct `apps/web` deps so esbuild can bundle them (pnpm
  isolated modules). No ORM dedup regression — the `pnpm.overrides` pin keeps one type context.
- `scripts/` excluded from `apps/web/tsconfig.json` so Next's build doesn't typecheck the
  migrate source (esbuild compiles it).

## Operator note
Set **`DIRECT_URL`** on the Dokploy web service (session pooler, 5432). Runbook
([deployment-dokploy](../02_architecture/deployment-dokploy.md)) updated with the auto-migration
behavior + the IPv4/pooler gotcha (6543 runtime, 5432 migrations; avoid the IPv6-only direct host).
