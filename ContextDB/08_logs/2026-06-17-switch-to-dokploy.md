# 2026-06-17 — Switch deployment to Dokploy

Railway deployed the web image successfully ("Active") but returned **502** on every route.
The image is proven good (locally from `Dockerfile.web` it binds `0.0.0.0:3000` and serves
`/login` 200), so the 502 was Railway **edge port routing**, not an app bug — and it resisted
the `HOSTNAME=0.0.0.0` and target-port fixes. Switched the host to **Dokploy** (the PRD's
original target), where Traefik routes to a **fixed container port (3000)** — explicit mapping
that avoids the dynamic-port mismatch.

## Changes (this PR)
- **ADR:** [switch-to-dokploy](../03_decisions/2026-06-17-switch-to-dokploy.md) supersedes the
  [Railway ADR](../03_decisions/2026-06-17-railway-supabase-deployment.md) (marked superseded;
  Railway kept as a documented alternative — same image).
- **Runbook:** [deployment-dokploy.md](../02_architecture/deployment-dokploy.md) — Supabase +
  Dokploy from zero (Application via `Dockerfile.web` now; Compose for the full stack at Step 5).
- **`docker-compose.dokploy.yml`** — production stack scaffold (web active; api/worker/redis
  commented for Step 5).
- README + system-overview deployment sections updated to Dokploy; project map relinked.

## No code change
`Dockerfile.web` (with `HOSTNAME=0.0.0.0` + `PORT=3000`, merged in PR #5) is portable and
unchanged — it runs the same on Dokploy. `apps/web/railway.json` is retained (harmless) for the
Railway-alternative path. `docker-compose.yml` stays for local Redis only.

## Deploy (owner)
Dokploy → Application → repo `main`, Build = Dockerfile, path `Dockerfile.web`, context = repo
root → Domains: map to container **port 3000**, HTTPS → set env vars (DATABASE_URL pooler,
AUTH_SECRET, NEXTAUTH_URL, SLACK_*, INTERNAL_API_SECRET) → add the Slack redirect
`https://<domain>/api/auth/callback/slack`. Migrations: `DIRECT_URL=… pnpm db:migrate` locally.
