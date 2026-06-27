# Deployment — Dokploy + Supabase

How to deploy poddaily on **Dokploy** (self-hosted PaaS on Docker + Traefik) with a **Supabase
cloud** database. This is the chosen host — see the
[switch-to-Dokploy ADR](../03_decisions/2026-06-17-switch-to-dokploy.md). (Railway remains a
viable alternative — [Railway runbook](deployment-railway.md) — the Docker image is identical.)

> **Status:** the **full stack is deployable** as of Step 5b. `web` (`Dockerfile.web`), `api`
> (`Dockerfile.api`), `worker` (`Dockerfile.worker`), and **Redis** are all defined in
> `docker-compose.dokploy.yml`. Deploy the whole stack via the **Compose** path (Part B,
> Option 2) so `api`/`worker` share a Docker network with `redis` (a standalone Application
> can't resolve `redis://redis:6379`). Sections still marked **(Step 5)** below are historical
> notes from when only `web` was live.

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

1. Create the project at <https://supabase.com>. From the **Connect** dialog grab the
   **Transaction pooler** URL (port `6543`) → `DATABASE_URL`, and the **Session pooler** URL
   (same `…pooler.supabase.com` host, port `5432`) → `DIRECT_URL`. Both are IPv4; the *direct*
   `db.<ref>.supabase.co` endpoint is IPv6-only — avoid it (see the gotcha in Part C).
2. **Migrations run automatically on deploy** (the web container migrates on boot against
   `DIRECT_URL`). You only need to migrate manually if you want the schema ready *before* the
   first deploy or to seed data:
   ```bash
   DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" pnpm db:migrate
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
| `DATABASE_URL` | Supabase **transaction pooler** — host `…pooler.supabase.com`, port **6543**, user `postgres.<ref>` (IPv4; runtime queries) |
| `DIRECT_URL` | Supabase **session pooler** — same host, port **5432**, user `postgres.<ref>` (IPv4; used by the on-boot migration) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | same value |
| `NEXTAUTH_URL` | `https://<your-dokploy-domain>` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | from the Slack app |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` (shared with api/worker at Step 5) |

> **IPv4 / Supabase gotcha:** use the **pooler** host (`…pooler.supabase.com`, user
> `postgres.<ref>`) for both URLs. The *direct* endpoint (`db.<ref>.supabase.co:5432`) is
> **IPv6-only** and self-hosted Docker hosts usually can't route it (`ENETUNREACH`). Pooler =
> IPv4: **6543** transaction mode for runtime, **5432** session mode for migrations (DDL needs
> a session). Copy both strings from Supabase's **Connect** dialog rather than hand-building them.

`PORT` and `HOSTNAME` are already baked into the image (`3000` / `0.0.0.0`) — no need to set
them. Do not set a build-time `DATABASE_URL`; the Dockerfile bakes a throwaway dummy for the
build stage only.

### Migrations run automatically on deploy
The web container's entrypoint runs `node migrate.mjs` (a bundled drizzle migrator) **before**
starting the server, applying any pending migrations against `DIRECT_URL`. So a normal deploy
migrates the schema — no manual step. It's idempotent (drizzle tracks applied migrations) and
**non-blocking**: if a migration fails it logs `[migrate] failed:` / a `WARNING` and still
starts the server (so `/login` stays up) — watch the deploy logs for that line. Assumes a
single web replica (`replicas: 1`); for multiple replicas, move migration to a one-off step.

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
- Update the Slack app's Event Subscriptions **Request URL** to `https://<api-domain>/slack/events`
  (Bolt v4's default receiver serves `/slack/events` — **no** `/api` prefix), subscribed to the
  `message.im` bot event. The api needs `SLACK_SIGNING_SECRET` set (matching the Slack app's
  Signing Secret) or the URL won't verify.

## Production gotchas (learned walking the Step 5b live deploy)

- **Leave `SLACK_API_BASE_URL` UNSET in production.** It only exists to point the Slack client
  at the local test stub (`http://127.0.0.1:4010`). If it leaks into the api/worker env (e.g.
  copied from a local `.env`), every Slack call fails with `ECONNREFUSED 127.0.0.1:4010` and no
  DM is sent. Unset → the client defaults to `https://slack.com/api/`.
- **Enable the DM reply box in the Slack app.** Slack disables replies to a bot by default
  ("Sending messages to this app has been turned off"). In the Slack app → **App Home → Show
  Tabs** → enable the **Messages Tab** and check **"Allow users to send Slash commands and
  messages from the messages tab."** Without this the outbound DM arrives but the user can't
  answer.
- **Bot scopes for the DM Q&A:** `chat:write` + `im:write` (post / open DM) and **`im:history`**
  (receive replies). Adding a scope requires reinstalling the app → new `SLACK_BOT_TOKEN`.
- **Standalone Application can't reach `redis://redis:6379`.** That hostname only resolves
  inside the Compose stack's network. Deploy via the **Compose** path (Part B Option 2) so
  api/worker share a network with `redis`; a per-service Application needs the Redis service's
  real internal host + a shared network.
- **`trigger` takes the standup id, not the team id.** The `/teams/<teamId>/standup` URL shows
  the *team* id; `openRun` looks up `standups.id`, so triggering with a team id is a silent
  no-op (the `open-run` job logs "done" but opens no run). Get the id from `select id from
  standups`.
- **A manual `trigger` still respects the configured send time + active weekdays.** It's not a
  "send now" button: each member's DM fires at their local configured time, and `openRun` skips
  non-active weekdays. It only sends immediately if the configured time has already passed today.
- **After deploying RBAC (or any release that adds login-time provisioning), existing logged-in
  users must sign out and back in.** Roles are created by the `signIn` callback, which only runs
  at authentication time — a session held from *before* the deploy is never provisioned, so the
  user resolves to `viewer` and the **People** page throws `Forbidden` even though they're "logged
  in." The fix is a full re-login (Sign out in the sidebar, or `/api/auth/signout`); the first
  re-login while `app_users` has zero admins bootstraps that user to `admin`. Symptom that pins
  it: `select * from app_users` is empty yet the dashboard renders. (Learned walking the Phase 2-D
  live smoke — see `08_logs/2026-06-27-rbac-live-smoke.md`.)

## Local vs deploy

The repo's `docker-compose.yml` stays for **local Redis only**; `docker-compose.dokploy.yml`
is the production stack. Local dev still uses the Supabase CLI
(see [getting-started](../00_index/getting-started.md)).
