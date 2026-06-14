# System Overview

How poddaily is structured at runtime. See the
[architecture diagram](../07_diagrams/architecture.mmd.md) for the visual.

## Monorepo layout (pnpm workspaces)

```
poddaily/
├─ apps/
│  ├─ web/          Next.js 15 admin UI + NextAuth (admin Slack OAuth)
│  │  ├─ app/(auth)/ , app/(dashboard)/teams/ , app/(dashboard)/settings/
│  │  └─ components/
│  ├─ api/          Hono.js REST API
│  │  ├─ routes/    teams, members, standup, internal
│  │  ├─ middleware/  signing-secret verify, internal bearer auth
│  │  └─ slack/     Bolt event + interaction handlers, OAuth install/callback
│  └─ worker/       BullMQ workers (no HTTP)
│     ├─ jobs/      send-standup-dm.ts, send-reminder.ts (P2), complete-run.ts
│     └─ scheduler.ts
├─ packages/
│  ├─ db/           Drizzle schema + migrations
│  ├─ shared/       Types, constants, interpolation, Block Kit builders
│  └─ slack-client/ Wrapper over @slack/web-api
├─ docker-compose.yml
├─ .env.example
└─ README.md
```

## Services

| Service | Container | Port | Notes |
|---|---|---|---|
| poddaily-web | Next.js | 3000 | Admin UI + NextAuth |
| poddaily-api | Hono/Node | 3001 | REST API + Slack endpoints |
| poddaily-worker | Node | — | BullMQ workers, no HTTP |
| redis | redis:7-alpine | 6379 | BullMQ queue + scratch (self-hosted) |

**Postgres is external (Supabase)** — not a container. See
[Supabase ADR](../03_decisions/2026-06-14-supabase-as-database.md). The `docker-compose`
therefore omits a `postgres` service and `pgdata` volume; it keeps `web`, `api`, `worker`,
`redis`, and a `redisdata` volume.

## Runtime data flow (one standup run)

1. **worker/scheduler** — a BullMQ repeatable job per active standup fires; it calls
   `POST /internal/runs/start/:standupId` to create a `standup_run`, then enqueues one
   `send-standup-dm` job per member scheduled to that member's local send time.
2. **send-standup-dm** — opens a Slack DM, posts intro + first question, writes an
   `in_progress` `standup_reports` row.
3. **api/slack** — each user reply hits `POST /api/slack/events` (`message.im`). The handler
   reconstructs progress from `standup_reports.answers`, persists the answer, and posts the
   next question. On the last answer it marks the report `completed` and triggers broadcast.
4. **broadcast** — posts/looks up the run's opening thread message, then posts the user's
   report as a threaded reply using the user's token (post-as-user).
5. **complete-run / timeout sweeper** — finalizes the run; `in_progress` reports past the
   4-hour timeout become `timed_out` and are never posted.

## Why this shape

- **API and worker are separate processes** so scheduling/retry load never blocks HTTP, and
  the worker can scale independently. They communicate over the internal bearer-authed
  endpoints, never by sharing in-memory state.
- **packages/shared holds the pure logic** (interpolation, Block Kit, schedule math) so it's
  unit-testable and reused by both api and worker without duplication.
- **packages/db is the single source of truth** for schema; both api and worker import it.

## Deployment

Dokploy on ROSA/EKS. `NEXTAUTH_URL=https://poddaily.clara.tools`. Env via `.env` per the
[Phase 1 spec env list](../01_specs/phase-1-core-spec.md#11-environment-variables-phase-1).
