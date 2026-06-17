# ADR: Deploy on Railway with a Supabase cloud database

- **Date:** 2026-06-17
- **Status:** Superseded by [Host on Dokploy](2026-06-17-switch-to-dokploy.md) — Railway hit a
  502 from edge port routing; we moved to Dokploy (fixed-port Traefik routing). Railway remains
  a documented alternative; the Docker image is identical.

## Context

The PRD specified **Dokploy on ROSA/EKS** as the deployment target. That assumed internal
PaaS/Kubernetes infrastructure. For getting poddaily live quickly (and as an open-source
project others can self-host), a managed platform with first-class GitHub deploys is a better
fit. We already use **Supabase** as the managed Postgres ([Supabase ADR](2026-06-14-supabase-as-database.md));
the repo is on GitHub (`maggit/poddaily`).

## Decision

Deploy on **Railway**, with the database on a **Supabase cloud project**.

- Each service is a Railway service built from a **Dockerfile** in the repo (monorepo, one
  Dockerfile per app). The web app ships now as `Dockerfile.web` (Next.js **standalone**
  output); `apps/api` and `apps/worker` get their own Dockerfiles when they're built in Step 5.
- **Redis** is a Railway plugin/service (needed by BullMQ from Step 5).
- **Postgres** stays external on **Supabase** — Railway connects to it via `DATABASE_URL`
  (pooled, 6543) at runtime and `DIRECT_URL` (direct, 5432) for migrations.
- Config-as-code via per-service `railway.json` (e.g. `apps/web/railway.json`).

## Consequences

- **Web app is deployable today** — `Dockerfile.web` builds a verified standalone image
  (~238 MB, `node:22-alpine`); `/login` serves without the DB.
- **First actual deploy waits for Step 5**, when `apps/api` + `apps/worker` + Redis exist, so
  the full topology goes live together (per the owner's call).
- Build-time note: the web DB singleton initializes at import, so `next build` needs a
  **dummy `DATABASE_URL`** (baked only into the build stage; the runner uses the real one).
- Migrations run against Supabase's **direct** connection (`DIRECT_URL`), not the pooler —
  see the [Railway deployment runbook](../02_architecture/deployment-railway.md).
- The PRD's Dokploy/`docker-compose` topology is superseded for hosting; `docker-compose.yml`
  remains for **local** Redis only.

## Alternatives considered

- **Dokploy on ROSA/EKS (PRD original)** — requires internal k8s infra; heavier to stand up and
  less friendly for open-source self-hosters. Revisit if an internal-infra mandate returns.
- **Fly.io / Render** — comparable managed options; Railway chosen for its GitHub-native
  multi-service monorepo deploys and the CLI already in use.
- **Supabase-hosted everything (edge functions)** — doesn't fit a long-lived BullMQ worker or
  the Hono API; Railway runs persistent containers.
