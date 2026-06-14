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
- [ ] Slack OAuth admin login
- [ ] Team CRUD (name, Slack channel, tribe)
- [ ] Member management with per-member permissions + timezone capture
- [ ] Standup configuration (questions, schedule, intro/outro)
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
pnpm dev                          # web :3000, api :3001, worker
pnpm smoke:phase1                 # end-to-end smoke test
```

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

Containers for `web`, `api`, `worker`, and `redis` (Postgres is external via Supabase),
orchestrated by `docker-compose` on Dokploy. See
[System Overview](ContextDB/02_architecture/system-overview.md).

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
