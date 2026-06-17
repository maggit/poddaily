# 2026-06-17 — Deployment Prep: Railway + Supabase

Made poddaily ready to deploy on **Railway** with a **Supabase cloud** database (config +
runbook; first actual deploy is held until Step 5 when api/worker/Redis exist — owner's call).

## Decision
Switch the hosting target from the PRD's Dokploy/ROSA to **Railway + Supabase cloud** —
[ADR](../03_decisions/2026-06-17-railway-supabase-deployment.md). Per-app Dockerfiles; Supabase
external (pooled runtime + direct migrations); Redis as a Railway plugin (Step 5).

## Done
- **Web app is deployable now.** `Dockerfile.web` (multi-stage, pnpm, Next.js **standalone**)
  builds a verified image (~238 MB, `node:22-alpine`); a test container booted and served
  `/login` (200) without a DB. `next.config.ts` gains `output: "standalone"`,
  `outputFileTracingRoot` (repo root), and `transpilePackages` for the workspace packages.
  `apps/web/railway.json` (config-as-code: Dockerfile build + `/login` healthcheck).
- **Runbook:** [deployment-railway.md](../02_architecture/deployment-railway.md) — from zero:
  create the Supabase project (pooled + direct URLs, run migrations), create the Railway
  project from GitHub, web service build/env/domain, migrations-on-deploy strategy, and the
  Step-5 additions (api/worker/Redis).
- Updated README + system-overview deployment sections (Dokploy → Railway); linked the ADR +
  runbook from the project map.

## Notes
- Build-time `DATABASE_URL` is a throwaway dummy (the DB singleton initializes at import); the
  runner uses the real value. Migrations run against Supabase **direct** (5432), never the pooler.
- Non-fatal build warning: missing `eslint-plugin-react-hooks` in the production install — Next
  logs and continues; harmless (could add the plugin or `eslint.ignoreDuringBuilds` later).
- `docker-compose.yml` stays for **local** Redis only.

Next: build-order step 5 — scheduler + DM engine (`apps/api` + `apps/worker`), after which the
full Railway topology goes live and the deploy runbook is walked for real.
