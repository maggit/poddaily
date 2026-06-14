# Phase 1 Core — Design Spec

> Validated design for the first build of poddaily. Derived from the
> [PRD](poddaily-prd.md) and the planning session on 2026-06-14
> ([log](../08_logs/2026-06-14-planning-session.md)).

## 1. Scope

**In scope (Phase 1 Core):**
- Slack OAuth admin authentication (NextAuth v5).
- Team CRUD — name, Slack channel (picker), tribe.
- Member management — add/remove members pulled from the Slack workspace, per-member
  permissions (view / report / edit), and per-member timezone capture.
- Standup configuration — questions (add/remove/reorder), schedule (weekday picker + time),
  intro/outro messages.
- Per-user-timezone BullMQ scheduler that opens a run and fans out one DM per member at
  that member's local send time.
- Conversational DM Q&A engine (one question at a time, free-text, skip / skip all,
  4-hour timeout).
- Channel broadcast: opening thread message + each completed report posted as a threaded
  reply **attributed to the actual user via their Slack user token**.

**Out of scope (later phases):**
- Today's dashboard, participation stats, one-click reminders, pause/resume UX → Phase 2.
- Analytics, `/standup` slash command, Databricks webhook, streak/happiness widgets → P1.
- Multiple standups per team, polls, AI summary, OOO detection, prior-tool migration → P2.

## 2. Locked decisions

| Decision | Choice | ADR |
|---|---|---|
| Channel attribution | Post **as the user** via per-reporter user tokens | [ADR](../03_decisions/2026-06-14-post-as-user-tokens.md) |
| Scheduling timezone | **Per-user** local timezone | [ADR](../03_decisions/2026-06-14-per-user-timezone.md) |
| Slack app | New app **"poddaily"** with committed manifest | [ADR](../03_decisions/2026-06-14-new-slack-app.md) |
| Database | **Supabase** managed Postgres (DB only; NextAuth for auth) | [ADR](../03_decisions/2026-06-14-supabase-as-database.md) |
| Build order | **Vertical slice** first | [ADR](../03_decisions/2026-06-14-vertical-slice-build.md) |
| DM conversation state | **Stateless** — reconstructed from Postgres | [ADR](../03_decisions/2026-06-14-stateless-dm-state.md) |

## 3. Architecture

Monorepo via **pnpm workspaces**. Three apps, three packages. See
[system overview](../02_architecture/system-overview.md) and
[architecture diagram](../07_diagrams/architecture.mmd.md).

```
apps/
  web/      Next.js 15 admin UI + NextAuth (admin Slack OAuth)
  api/      Hono REST + Slack events/interactions + reporter user-OAuth + internal endpoints
  worker/   BullMQ: scheduler, send-standup-dm, complete-run, timeout sweeper
packages/
  db/       Drizzle schema + migrations
  shared/   Types, constants, question interpolation, Block Kit builders
  slack-client/  Thin wrapper over @slack/web-api (bot token + per-user tokens)
```

Runtime dependencies: **Supabase Postgres** (pooled at runtime, direct for migrations),
**self-hosted Redis** (BullMQ), **Slack API**.

## 4. Data model

Base schema is the PRD's. Phase 1 deltas (full detail in
[data model](../02_architecture/data-model.md)):

1. `team_members.timezone TEXT` — IANA TZ seeded from Slack `users.info.tz`; drives the scheduler.
2. New `slack_user_tokens` table — encrypted per-reporter user token for post-as-user.
3. `standup_reports.status` — `in_progress | completed | timed_out` so the stateless engine
   can resume and so timed-out partials never post to the channel.

## 5. Slack integration

Three Slack surfaces (full detail in [slack integration](../02_architecture/slack-integration.md)):

- **Admin auth** — NextAuth v5 Slack OIDC for the web app. Admin identity only.
- **Reporter user-OAuth** — separate install link granting a **user token** with `chat:write`.
  First DM to a member without a token includes a one-time "connect to post as yourself"
  action. Until connected, gracefully fall back to bot-posting the report with the user's
  name surfaced (logged as degraded).
- **Bot** — `@slack/bolt` handling `message.im`. DM flow: scheduler enqueues per member →
  bot opens DM, posts intro + Q1 → on each reply, reconstruct state from
  `standup_reports.answers`, persist, post next question → after the last question, mark
  `completed`, post outro, then broadcast.

Broadcast: one opening thread message per run; each completed report is a threaded reply
posted with the user's token, using Block Kit (header + divider + section-per-Q&A).

## 6. Scheduler

One BullMQ **repeatable job per active standup** opens a `standup_run`. Because TZ is
per-user, each member's `send-standup-dm` is scheduled against `team_members.timezone`
for the standup's configured local time and active weekdays. Failed sends retry 3× with
exponential backoff. A `complete-run` job + timeout sweeper close out the run; partials
left after 4h are marked `timed_out` and never posted. Detail in
[scheduler](../02_architecture/scheduler.md).

## 7. API surface (Phase 1 subset)

```
# Teams
GET/POST  /api/teams
GET/PATCH/DELETE  /api/teams/:id
# Members
GET/POST  /api/teams/:id/members
PATCH/DELETE  /api/teams/:id/members/:memberId
# Standup config
GET/PUT   /api/teams/:id/standup
# Slack
POST  /api/slack/events
POST  /api/slack/interactions
GET   /api/slack/install            # reporter user-OAuth
GET   /api/slack/oauth/callback
# Internal (worker↔api, bearer INTERNAL_API_SECRET)
POST  /internal/runs/start/:standupId
PATCH /internal/runs/:runId/complete
POST  /internal/reports
```

Deferred to Phase 2: `/api/teams/:id/standup/toggle`, `/reports`, `/reports/today`,
`/reminders`.

## 8. Admin UI (Phase 1 subset)

`/login` · `/teams` (list) · `/teams/new` · `/teams/[id]` (members + standup-config tabs) ·
`/teams/[id]/standup` (question editor with drag-reorder, schedule picker). shadcn/ui +
Tailwind, dark mode. Reports timeline + dashboard are Phase 2. **Visual/styling direction
to be supplied by the owner**; the spec treats styling as a thin layer over the structure.

## 9. Build order (vertical slice)

Each step is independently demoable and lands with the smoke checkpoint that proves it.

1. Monorepo scaffold + `packages/db` (Drizzle schema + first migration) + `packages/shared`
   + local dev setup (Supabase CLI, Redis, seed). → `smoke:db`
2. Slack app manifest + bot install + admin NextAuth login. → `smoke:auth`
3. Team create + add member (captures TZ) — minimal API + UI. → `smoke:team`
4. Standup config (questions + schedule). → `smoke:config`
5. Scheduler → `send-standup-dm` → DM Q&A engine. **(core risk — front-loaded)** → `smoke:standup`
6. Reporter user-OAuth + post-as-user channel broadcast + threading. → `smoke:standup` (broadcast assertions)
7. Timeout / skip handling + retry. → `smoke:edges`

## 10. Testing

Full strategy in [testing & local dev](../02_architecture/testing-and-local-dev.md) and the
[e2e-smoke ADR](../03_decisions/2026-06-14-e2e-smoke-with-slack-stub.md).

- **Unit (TDD-first):** pure logic in `packages/shared` — DM state reconstruction, per-user-TZ
  schedule math, `{last_report_date}` interpolation, Block Kit builders.
- **Integration:** a route/job against local Postgres + a mocked Slack client.
- **Smoke (E2E):** `pnpm smoke:phase1` drives the whole stack (DB → API → worker → **Slack
  stub**) through real user scenarios; the keystone `smoke:standup` proves the full
  trigger → DM Q&A → post-as-user broadcast pipeline. CI runs unit + integration + smoke with
  no secrets.
- **Live smoke:** a manual runbook against a real Slack dev workspace, walked once before the
  phase is declared done.

Local stack: Supabase CLI (Postgres) + Redis container; the Slack boundary is faked via
`SLACK_API_BASE_URL` pointing at the stub.

**Definition of done** (canonical list in
[testing & local dev](../02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)):
a phase is done only when its automated smoke is green in CI, the live runbook has been walked
once, the root **README is updated** (feature checklist + any new setup/usage info for
open-source users), and the affected `ContextDB/` docs + getting-started runbook are current.

## 11. Environment variables (Phase 1)

```
# Database (Supabase)
DATABASE_URL=postgresql://...:6543/postgres   # pooled (transaction mode), runtime
DIRECT_URL=postgresql://...:5432/postgres     # direct (session mode), migrations
# Redis (self-hosted)
REDIS_URL=redis://...
# Slack app "poddaily"
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
# Auth (NextAuth)
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://poddaily.clara.tools
# Internal worker↔api auth + token encryption key derivation
INTERNAL_API_SECRET=...
```

## 12. Open questions (non-blocking, carried from PRD)

- **RBAC (PRD Q3):** Phase 1 default — anyone who can complete admin Slack OAuth is an
  admin. Role tiers (EM/director) deferred.
- **Prior-tool data migration (PRD Q5):** deferred (P2).
- **Compliance on stored answers (PRD Q6):** confirm with Security before storing
  security-team standup data; may affect retention/encryption of `standup_reports.answers`.
