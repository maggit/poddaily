# Deployment — Railway + Supabase

How to deploy poddaily to **Railway** with a **Supabase cloud** database, from zero. Decision:
[Railway + Supabase ADR](../03_decisions/2026-06-17-railway-supabase-deployment.md).

> **Update 2026-07-08:** the per-service Dockerfiles this runbook references were replaced by
> one unified root `Dockerfile` (container command picks `web`/`api`/`worker`), and published
> images are available at `ghcr.io/maggit/poddaily` — on Railway you can deploy from the image
> instead of building. See [deployment-docker-image.md](deployment-docker-image.md).

> **Status:** the **web app is deployable now** (`Dockerfile.web`, verified). `apps/api`,
> `apps/worker`, and Railway **Redis** arrive in build-step 5 — the first full go-live is then.
> Sections below marked **(Step 5)** aren't needed yet.

## Topology

```
Railway project "poddaily"
├─ web      (Dockerfile.web)      Next.js admin UI + NextAuth      :PORT → public domain
├─ api      (Step 5)              Hono REST + Slack events/OAuth
├─ worker   (Step 5)              BullMQ workers (no public port)
└─ redis    (Step 5)              Railway Redis plugin
        │
        └── DATABASE_URL / DIRECT_URL ──▶  Supabase cloud Postgres (external)
```

## Part A — Create the Supabase cloud database

1. Create a project at <https://supabase.com> → choose a region near Railway's → set a strong
   DB password (save it).
2. **Project Settings → Database → Connection string**, grab both:
   - **Transaction pooler** (host `…pooler.supabase.com`, port `6543`) → this is **`DATABASE_URL`** (runtime).
   - **Direct connection** (host `db.<ref>.supabase.co`, port `5432`) → this is **`DIRECT_URL`** (migrations).
3. **Run migrations against the cloud DB** (from your machine; needs `DIRECT_URL`):
   ```bash
   DIRECT_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" pnpm db:migrate
   ```
   (Optionally `pnpm seed` for a first team, or create teams in the UI after deploy.)

> Migrations use the **direct** connection (5432), never the transaction pooler (6543) — the
> pooler doesn't support the session-level DDL migrations need. See the
> [Supabase ADR](../03_decisions/2026-06-14-supabase-as-database.md).

## Part B — Create the Railway project + web service

You can use the dashboard or the `railway` CLI (already installed locally).

### Dashboard
1. <https://railway.app> → **New Project → Deploy from GitHub repo** → select `maggit/poddaily`.
2. Railway creates a service. Open its **Settings**:
   - **Build:** it picks up **`apps/web/railway.json`** (config-as-code), which builds
     `Dockerfile.web` from the repo root. (If not auto-detected, set Config-as-code path to
     `apps/web/railway.json`, or set Builder = Dockerfile, Dockerfile path = `Dockerfile.web`.)
   - **Networking:** generate a domain (e.g. `poddaily-web-production.up.railway.app`) or attach
     a custom domain.
3. Set the **service variables** (Part C), then **Deploy**.

### CLI (alternative)
```bash
railway login
railway init           # or: railway link   (to an existing project)
railway up             # build + deploy the current service from the repo
railway domain         # generate a public domain
```

## Part C — Web service environment variables (set in Railway)

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase **pooled** (6543) | runtime queries |
| `DIRECT_URL` | Supabase **direct** (5432) | only needed if migrating from the service |
| `AUTH_SECRET` | `openssl rand -base64 32` | NextAuth v5 reads `AUTH_SECRET` |
| `NEXTAUTH_SECRET` | same value | kept for compatibility |
| `NEXTAUTH_URL` | `https://<your-web-domain>` | the deployed public URL |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | from the Slack app | admin login |
| `SLACK_OIDC_BASE` | *(unset)* | defaults to `https://slack.com`; only set to point at the stub |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` | worker↔api bearer + token encryption (used Step 5) |
| `NODE_ENV` | `production` | Railway sets this; the Dockerfile also defaults it |

Railway injects **`PORT`** automatically; the Dockerfile defaults to 3000 and Next standalone
honors `PORT`. Do **not** set a build-time `DATABASE_URL` in Railway — the Dockerfile bakes a
throwaway dummy for the build stage only; the runner uses the real one above.

**After the domain is known**, update the **Slack app** (`app_manifest.yaml`) redirect URLs +
event request URL to the real host — see [getting-started Track B](../00_index/getting-started.md#b2-create-the-slack-app-poddaily).
For admin login the redirect is `https://<web-domain>/api/auth/callback/slack`.

## Part D — Migrations on deploy

The web app does **not** run migrations on boot (a long-lived container shouldn't migrate on
every restart, and multiple instances would race). Run them explicitly when the schema changes:

- **Locally / CI** against `DIRECT_URL` (Part A step 3), **or**
- **Via Railway CLI** as a one-off: `railway run --service web pnpm db:migrate` with `DIRECT_URL`
  available to that service.

drizzle-kit migrations are idempotent, so re-running is safe.

## Part E — Verify

1. Open `https://<web-domain>/login` → the dark login page renders (no DB needed).
2. Complete Slack admin login → reach `/dashboard` (needs `DATABASE_URL` + the Slack app
   configured with the deployed redirect URL).
3. Create a team / add a member / configure a standup → confirms the DB connection.

## (Step 5) api, worker, Redis

When `apps/api` + `apps/worker` land:
- Add `Dockerfile.api` and `Dockerfile.worker` + `apps/api/railway.json`, `apps/worker/railway.json`.
- Add a **Railway Redis** service; set `REDIS_URL` on api + worker from it.
- `api` gets a public domain (Slack events/OAuth request URLs point at it); `worker` has no
  public port.
- Share `DATABASE_URL`, `INTERNAL_API_SECRET`, `SLACK_*` across the services as needed.
- Update the Slack app's event request URL to `https://<api-domain>/slack/events`.

## Local vs deploy

`docker-compose.yml` stays for **local Redis only**. Local dev still uses the Supabase CLI
(see [getting-started](../00_index/getting-started.md)). This runbook is for the hosted
environment.
