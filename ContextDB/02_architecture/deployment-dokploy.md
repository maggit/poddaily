# Deployment — Dokploy + Supabase

How to deploy poddaily on **Dokploy** (self-hosted PaaS on Docker + Traefik) with a **Supabase
cloud** database. This is the chosen host — see the
[switch-to-Dokploy ADR](../03_decisions/2026-06-17-switch-to-dokploy.md). (Railway remains a
viable alternative — [Railway runbook](deployment-railway.md) — the Docker image is identical.)

> **Status:** the **web app is deployable now** (`Dockerfile.web`, verified). `apps/api`,
> `apps/worker`, and **Redis** arrive in build-step 5; the full stack goes live then (via the
> compose file below). Sections marked **(Step 5)** aren't needed yet.

## Why Dokploy works cleanly here

The container listens on a **fixed `0.0.0.0:3000`** (`Dockerfile.web` sets `HOSTNAME=0.0.0.0`
+ `PORT=3000`). Dokploy's Traefik routes your domain to that fixed container port — no
dynamic-port matching to get wrong. The same image is verified to serve `/login` (200).

## Topology

```
Dokploy host (Docker + Traefik)
├─ web      (Application: Dockerfile.web)   Next.js admin UI   → domain, port 3000
├─ api      (Step 5)                        Hono REST + Slack
├─ worker   (Step 5)                        BullMQ (no domain)
└─ redis    (Step 5)                        redis:7 service
        │
        └── DATABASE_URL / DIRECT_URL ──▶  Supabase cloud Postgres (external)
```

## Part A — Supabase (same as before)

1. Create the project at <https://supabase.com>; grab the **Transaction pooler** URL (port
   `6543`) → `DATABASE_URL`, and the **Direct** URL (port `5432`) → `DIRECT_URL`.
2. Run migrations from your laptop against the direct URL:
   ```bash
   DIRECT_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" pnpm db:migrate
   ```

## Part B — Deploy the web app (now)

Two options; the **Application** path is simplest for the single web service today.

### Option 1 — Application (Dockerfile) — recommended now
1. Dokploy → **Create → Application**.
2. **Provider:** GitHub → repo `maggit/poddaily`, branch `main`.
3. **Build Type:** **Dockerfile**. **Dockerfile Path:** `Dockerfile.web`. Leave the build
   context at the **repo root** (the Dockerfile copies the whole workspace — do not set a
   sub-directory).
4. **Environment** (see Part C), then **Deploy**.
5. **Domains** tab → add your domain → **Container Port = `3000`** → enable HTTPS (Traefik /
   Let's Encrypt). That's the routing that fixes the 502 class of issues — the port is explicit.

### Option 2 — Docker Compose (use this for the full stack at Step 5)
1. Dokploy → **Create → Compose**.
2. **Provider:** GitHub → repo/branch `main`. **Compose Path:** `docker-compose.dokploy.yml`.
3. Set environment variables (Part C) in Dokploy's env panel; map a domain to the `web`
   service on port `3000`.

## Part C — Environment variables (web)

| Var | Value |
|---|---|
| `DATABASE_URL` | Supabase **pooler** (6543) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | same value |
| `NEXTAUTH_URL` | `https://<your-dokploy-domain>` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | from the Slack app |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` (shared with api/worker at Step 5) |

`PORT` and `HOSTNAME` are already baked into the image (`3000` / `0.0.0.0`) — no need to set
them. Do not set a build-time `DATABASE_URL`; the Dockerfile bakes a throwaway dummy for the
build stage only.

## Part D — Slack app

After the domain is live, add the admin-login redirect URL to the Slack app:
`https://<dokploy-domain>/api/auth/callback/slack` (see
[getting-started Track B](../00_index/getting-started.md#b2-create-the-slack-app-poddaily)).

## Part E — Verify

1. `https://<dokploy-domain>/login` → 200 (dark login, no DB needed).
2. Slack admin login → `/dashboard` (needs `DATABASE_URL` + the Slack redirect + migrations run).
3. Create a team / configure a standup → confirms the DB.

## (Step 5) api, worker, Redis

When `apps/api` + `apps/worker` land, the full stack runs from `docker-compose.dokploy.yml`:
- Uncomment the `api`, `worker`, and `redis` services (and add `Dockerfile.api` /
  `Dockerfile.worker`).
- `redis` is a compose service (Dokploy persists its volume); set `REDIS_URL=redis://redis:6379`
  for api + worker via Docker Compose's internal network.
- Map a domain to `api` (Slack events/OAuth request URLs point at it); `worker` has no domain.
- Share `DATABASE_URL`, `INTERNAL_API_SECRET`, `SLACK_*` across services.
- Update the Slack app's event request URL to `https://<api-domain>/api/slack/events`.

## Local vs deploy

The repo's `docker-compose.yml` stays for **local Redis only**; `docker-compose.dokploy.yml`
is the production stack. Local dev still uses the Supabase CLI
(see [getting-started](../00_index/getting-started.md)).
