# Self-hosting poddaily

Run poddaily on your own infrastructure from the published Docker images — no source
build required. Images are published to GHCR for `linux/amd64` and `linux/arm64`:

```
ghcr.io/maggit/poddaily
```

One image runs all three processes; the container command picks the role:

| Command  | Process                                      | Port |
|----------|----------------------------------------------|------|
| `web`    | Next.js admin UI + auth + health endpoint    | 3000 |
| `api`    | Slack events receiver (`POST /slack/events`) | 3001 |
| `worker` | BullMQ scheduler + outbound standup DMs      | —    |

Database migrations run automatically when any container starts (serialized across
containers by a Postgres advisory lock), so there is no separate migration step — ever.

## Prerequisites

- Docker Engine 24+ with the compose plugin (or Dokploy — see below).
- Two public HTTPS hostnames (or one hostname with path routing) behind your reverse
  proxy: one for the **web** UI, one for the **api** service that Slack calls.
- A Slack workspace where you can create an app.

## 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From
   an app manifest**, and paste [`app_manifest.yaml`](app_manifest.yaml), replacing
   `poddaily.example.com` with your domains first (events + slash command point at the
   **api** domain, OAuth redirect URLs at the **web** domain).
2. Install the app to your workspace.
3. Collect: **Bot User OAuth Token** (`xoxb-…`), **Signing Secret**, **Client ID**,
   **Client Secret**.

## 2. Quick start (Docker Compose)

```bash
mkdir poddaily && cd poddaily
curl -fsSLO https://raw.githubusercontent.com/maggit/poddaily/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/maggit/poddaily/main/deploy/.env.example
# Fill in .env (secrets, Slack credentials, your public URL)
docker compose up -d
```

The stack is web + api + worker + `postgres:18-alpine` + `redis:7-alpine`, with
healthchecks and `restart: unless-stopped` on everything. Verify:

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","version":"1.0.0","checks":{"database":"ok","redis":"ok"}}
```

Then point your reverse proxy at port `3000` (web) and `3001` (api), sign in at
`https://<your-web-domain>/team`, and configure your first standup.

## 3. Deploying on Dokploy

The compose file is compatible with Dokploy's **Docker Compose** service type:

1. In Dokploy: **Create Service → Compose**, and either point it at your fork of this
   repo with *Compose Path* `deploy/docker-compose.yml`, or choose the raw-compose
   option and paste the file's contents.
2. In the service's **Environment** panel, paste your filled-in `.env` (same keys as
   [`deploy/.env.example`](deploy/.env.example)).
3. Remove (or ignore) the `ports:` mappings if you prefer Dokploy's own routing, then
   add domains in the **Domains** tab:
   - your web domain → service `web`, port `3000`
   - your api domain → service `api`, port `3001`

   Dokploy provisions Traefik routing + Let's Encrypt certificates automatically; no
   manual Traefik labels are needed. (Adding `traefik.http.*` labels by hand also works
   if you manage Traefik yourself.)
4. Deploy. Migrations run on boot; watch the `web` service logs for
   `[migrate] schema up to date`.

## 4. Upgrading

Releases are semver git tags; every release publishes `X.Y.Z`, `X.Y`, `X`, and `latest`
image tags.

```bash
docker compose pull && docker compose up -d
```

That's the whole upgrade: new containers run their migrations automatically on start.
On Dokploy, hit **Redeploy** instead.

**Pinning:** `PODDAILY_TAG` in `.env` controls what "pull" means.

- `PODDAILY_TAG=latest` — every release, including breaking majors. Simplest, riskiest.
- `PODDAILY_TAG=1` — every `1.x.y` release; a new major never arrives unannounced.
  Recommended.
- `PODDAILY_TAG=1.2.3` — fully manual upgrades.

**Auto-updates:** if you want unattended upgrades, run a tool like
[Watchtower](https://containrrr.dev/watchtower/) alongside the stack (scoped to the
poddaily containers) — it is deliberately not part of the compose file. Downgrades are
not supported: migrations only roll forward, so restore a database backup instead.

## 5. Backups

All durable state lives in Postgres; Redis holds only in-flight job state and is
rebuilt by the worker on boot (losing it at worst drops an in-progress standup run).

```bash
# Back up (compressed custom format)
docker compose exec postgres pg_dump -U poddaily -Fc poddaily > poddaily-$(date +%F).dump

# Restore into a fresh stack
docker compose exec -T postgres pg_restore -U poddaily -d poddaily --clean --if-exists < poddaily-YYYY-MM-DD.dump
```

Schedule the dump with cron and ship it off-host. Volume snapshots of `pgdata` also
work, but only if Postgres is stopped (or you accept crash-consistent copies) —
`pg_dump` is the safer default.

## Troubleshooting

- `GET /api/health` on web returns per-dependency status
  (`{"checks":{"database":…,"redis":…}}`) and 503 when anything is down.
- A container that exits immediately at boot usually failed migrations — check its logs
  for `[migrate] failed:`; the restart policy retries once the database is reachable.
- Slack shows "dispatch_failed" on events → Slack can't reach
  `https://<api-domain>/slack/events`; check the api domain mapping and signing secret.
