# poddaily

> Self-hosted, Slack-native daily standup bot + admin platform. Open-source, no per-seat cost.

**Status:** 🚧 In development — **Phase 1 (Core)**. Nothing is shipped yet; this README and
the feature checklist below grow as each phase lands.

poddaily DMs each team member their standup questions in Slack, one at a time, then posts a
tidy summary to the team's channel — attributed to the person who wrote it. An admin web UI
manages teams (pods), members, questions, and schedules. It runs entirely on your own
infrastructure.

## Features

Checked items are implemented; unchecked are planned. Updated at the end of each phase.

**Phase 1 — Core**
- [x] Slack OAuth admin login
- [x] Team CRUD (name, Slack channel, tribe)
- [x] Member management with per-member permissions + timezone capture
- [x] Standup configuration (questions, schedule, intro/outro)
- [ ] Per-user-timezone scheduler
- [ ] Conversational DM Q&A (one question at a time, skip / skip all, timeout)
- [ ] Channel broadcast posted as the user, threaded under a daily opening message

**Phase 2 — Admin UX:** today's dashboard, participation stats, one-click reminders,
pause/resume.
**Phase 4 — P1:** analytics, `/standup` slash command, Databricks export webhook, streaks.

See the full [roadmap](#roadmap) and the [PRD](ContextDB/01_specs/poddaily-prd.md) for scope.

## Tech stack

Next.js 15 · Hono.js (Node 22) · BullMQ + Redis · PostgreSQL 16 (Supabase, managed) ·
Drizzle ORM · NextAuth v5 (Slack OAuth) · Tailwind + shadcn/ui · `@slack/bolt` ·
Dokploy. Monorepo via pnpm workspaces.

## Quick start

Run it locally with a stubbed Slack — no external accounts needed:

```bash
pnpm install
cp .env.example .env.local        # stub values are fine for local
supabase start                    # local Postgres
docker compose up -d redis        # queue
pnpm db:migrate && pnpm seed      # schema + known-state data
pnpm smoke:db                     # foundation end-to-end check (schema + seed + connectivity)
pnpm smoke:auth                   # admin Slack-login flow against the stub

# The admin web app (login + dashboard):
pnpm --filter @poddaily/web dev   # → http://localhost:3000 (signed out → /login)
```

> **Current state (through Step 2):** the commands above work today — the database layer and
> the admin web app with Slack OAuth login (`/login` → protected `/dashboard`). The multi-service
> `pnpm dev` and the full `pnpm smoke:phase1` arrive as later build steps land — see the
> [build order](ContextDB/01_specs/phase-1-core-spec.md#9-build-order-vertical-slice).

For the **complete from-zero runbook** — creating a Supabase project, registering and
configuring the Slack app (scopes, event URLs, tokens), tunnels, the reporter user-OAuth, and
every environment variable — see **[Getting Started](ContextDB/00_index/getting-started.md)**.

## Configuration

All configuration is via environment variables; copy `.env.example` to `.env.local`. Each
variable, where it comes from, and its local-vs-live value are documented in the
[env var reference](ContextDB/00_index/getting-started.md#environment-variable-reference).

## Testing

- `pnpm test` — unit + integration.
- `pnpm smoke:phase1` — end-to-end smoke against the whole stack with a stubbed Slack.
- A manual [live smoke runbook](ContextDB/02_architecture/testing-and-local-dev.md#live-smoke-runbook-before-shipping-a-phase)
  validates one real standup against a Slack dev workspace before a phase ships.

See [Testing & Local Dev](ContextDB/02_architecture/testing-and-local-dev.md).

## Deployment

Hosted on **Dokploy** (self-hosted, Docker + Traefik) with a **Supabase cloud** Postgres. Each
app is a Docker service (`web` now via `Dockerfile.web`; `api`/`worker`/Redis from Step 5 via
`docker-compose.dokploy.yml`). Full step-by-step:
**[Dokploy + Supabase runbook](ContextDB/02_architecture/deployment-dokploy.md)** (Railway is a
documented alternative — same image — in the [Railway runbook](ContextDB/02_architecture/deployment-railway.md)).

## Project context & docs

Long-lived context lives in [`ContextDB/`](ContextDB/) (managed with ContextLoom). Start at
the [project map](ContextDB/00_index/project-map.md): specs, architecture, and the
[decision records](ContextDB/03_decisions/) behind every major choice.

## Roadmap

| Phase | Scope |
|---|---|
| 1 — Core | Auth, team CRUD, standup config, Slack DM flow, channel broadcast, scheduler |
| 2 — Admin UX | Dashboard, participation stats, reminders, pause/resume |
| 3 — Polish + launch | Deploy, env config, docs, pilot |
| 4 — P1 features | Analytics, slash command, export webhook, streaks |

## Contributing

This is an open-source project. Before working on a phase, read the relevant spec and ADRs in
[`ContextDB/`](ContextDB/). Each phase ships with passing smoke tests, an updated README, and
the live smoke runbook walked once (see the per-phase Definition of Done in
[Testing & Local Dev](ContextDB/02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)).

## License

TBD — to be set before the first public release.
