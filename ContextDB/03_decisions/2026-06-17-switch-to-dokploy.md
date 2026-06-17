# ADR: Host on Dokploy (switch from Railway)

- **Date:** 2026-06-17
- **Status:** Accepted — supersedes [Railway + Supabase deployment](2026-06-17-railway-supabase-deployment.md)

## Context

We first targeted **Railway** ([prior ADR](2026-06-17-railway-supabase-deployment.md)). The
web image built and deployed ("Active"), but every route returned **502**. The image itself is
proven good — run locally from `Dockerfile.web` it binds `0.0.0.0:3000` and serves `/login`
(200). So the 502 was Railway **port routing** (the edge proxy targeting a port that didn't
match where the app listened), not an app bug, and it resisted the fixes attempted
(`HOSTNAME=0.0.0.0`, target-port). Dokploy was also the PRD's original direction.

## Decision

Host poddaily on **Dokploy** (self-hosted PaaS on Docker + Traefik), keeping the database on
**Supabase cloud**. Railway is documented as a working alternative (same image).

- Each app is a Docker service. The web app deploys today via `Dockerfile.web` as a Dokploy
  **Application**; the full stack (web + api + worker + redis) runs from
  `docker-compose.dokploy.yml` once Step 5 lands.
- Traefik routes each domain to a **fixed container port (`3000` for web)** — explicit port
  mapping, which avoids the dynamic-port mismatch that caused the Railway 502.
- Postgres stays external on Supabase (pooled at runtime, direct for migrations). Redis becomes
  a compose service (Step 5).

## Consequences

- **No application/Dockerfile change** — `Dockerfile.web` (with `HOSTNAME=0.0.0.0` + `PORT=3000`)
  is portable and already verified; only the hosting platform + its routing config differ.
- Deterministic routing: the container listens on a known `0.0.0.0:3000` and Traefik points at
  it explicitly. See the [Dokploy runbook](../02_architecture/deployment-dokploy.md).
- Self-hosted: we run the Dokploy host (vs Railway's managed platform) — more control, slightly
  more ops. Fits an open-source self-host story.
- `apps/web/railway.json` is retained (harmless) so the Railway path stays available.

## Alternatives considered

- **Stay on Railway** — the image is fine; the 502 is its edge port routing. Setting the
  service's target port to `3000` may resolve it, but after repeated attempts we chose the
  platform with explicit, fixed port mapping. Kept as a documented alternative.
- **Dokploy from day one (PRD)** — effectively where we landed; the Railway detour produced the
  portable Dockerfile + standalone setup, which Dokploy reuses unchanged.
