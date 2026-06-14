# Testing & Local Development

How to run poddaily locally and verify each phase end-to-end. The guiding rule: **every
phase ships with a runnable end-to-end smoke test** that proves the slice works, plus a short
manual runbook against a real Slack workspace before the phase is declared done. Decision:
[e2e-smoke ADR](../03_decisions/2026-06-14-e2e-smoke-with-slack-stub.md).

## Test layers

| Layer | What | Tool | Speed |
|---|---|---|---|
| Unit | Pure logic — TZ/schedule math, `{last_report_date}` interpolation, DM state reconstruction, Block Kit builders | Vitest | ms |
| Integration | A route or job against real local Postgres + a mocked Slack client | Vitest | sec |
| **Smoke (E2E)** | The whole stack (DB → API → worker → Slack stub) driven through a real user scenario | Vitest + Slack stub | tens of sec |
| **Live smoke** | One real standup against a Slack dev workspace, run manually before shipping a phase | Manual runbook | minutes |

Pure logic lives in `packages/shared` so it is unit-testable without infrastructure
(TDD-first per the [Phase 1 spec](../01_specs/phase-1-core-spec.md#10-testing)).

## Local environment

> For the complete from-zero setup — creating the Supabase project, registering and
> configuring the Slack app, tunnels, and every env var — follow the
> [Getting Started runbook](../00_index/getting-started.md). This section is the condensed
> version.

### Prerequisites
- Node 22 + pnpm
- Docker (for Redis)
- **Supabase CLI** (local Postgres matching prod — see
  [Supabase ADR](../03_decisions/2026-06-14-supabase-as-database.md))

### Bring up the stack
```bash
cp .env.example .env.local        # fill in local values (see below)
supabase start                    # local Postgres + Studio
docker compose up -d redis        # BullMQ queue
pnpm install
pnpm db:migrate                   # drizzle-kit against DIRECT_URL (local)
pnpm seed                         # known-state: 1 team, 1 member, 1 standup
pnpm dev                          # web :3000, api :3001, worker
```

### Local env (`.env.example`)
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   # supabase local
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
REDIS_URL=redis://127.0.0.1:6379
# Slack — for stubbed smoke these point at the local Slack stub; for live smoke, real values
SLACK_BOT_TOKEN=xoxb-stub
SLACK_SIGNING_SECRET=stub-signing-secret
SLACK_CLIENT_ID=stub
SLACK_CLIENT_SECRET=stub
SLACK_API_BASE_URL=http://127.0.0.1:4010   # ⬅ points slack-client at the stub in smoke mode
NEXTAUTH_SECRET=dev-secret
NEXTAUTH_URL=http://localhost:3000
INTERNAL_API_SECRET=dev-internal-secret
```

`SLACK_API_BASE_URL` is the seam: `packages/slack-client` reads it so smoke runs hit the
stub and prod hits `https://slack.com/api`.

## The Slack stub

A lightweight fake Slack server (`packages/slack-client/stub` or `tools/slack-stub`) used by
smoke tests. It:

- **Records** outbound Web API calls (`conversations.open`, `chat.postMessage`,
  `users.info`, `oauth.v2.access`, …) so the test can assert what the bot/user "posted".
- **Injects** inbound events — a helper posts a signed `message.im` payload to
  `POST /api/slack/events`, simulating a user's DM reply (signature computed with
  `SLACK_SIGNING_SECRET` so the real verification middleware runs).
- **Stubs tokens** — returns canned `oauth.v2.access` responses so the reporter user-OAuth
  flow can complete without a browser.

This exercises the **real** API/worker/DB code paths; only the Slack network boundary is
faked.

```mermaid
flowchart LR
  Smoke["pnpm smoke<br/>(Vitest)"] -->|seed + trigger run| Worker
  Smoke -->|inject signed message.im| API
  Worker --> DB[(Supabase local)]
  API --> DB
  Worker -->|enqueue| Redis[(Redis)]
  API -->|Web API calls| Stub["Slack stub<br/>:4010"]
  Worker -->|Web API calls| Stub
  Smoke -->|assert recorded calls| Stub
```

## Per-phase smoke scenarios (Phase 1 Core)

Each maps to a step in the [vertical-slice build order](../03_decisions/2026-06-14-vertical-slice-build.md).
`pnpm smoke:phase1` runs them in sequence — that sequence **is** the Phase 1 end-to-end test.

| Script | Scenario | Pass criteria |
|---|---|---|
| `smoke:db` | Migrations apply, `pnpm seed` populates, connectivity | All tables exist; seed rows present |
| `smoke:auth` | Admin NextAuth callback + bot install via stubbed OAuth | Session issued; bot token stored |
| `smoke:team` | Create team + add member via API | Team row created; member row has `timezone` captured from stubbed `users.info` |
| `smoke:config` | Configure standup questions + schedule | `standups` row persisted; repeatable job registered in BullMQ |
| `smoke:standup` | **Full happy path:** trigger run → simulate member answering each question → broadcast | Bot DM'd each question in order; `standup_reports` = `completed`; channel reply recorded with correct Block Kit + `thread_ts` under the run's opening message, posted with the **user token** |
| `smoke:edges` | `skip`, `skip all`, and 4-hour timeout | `skip` advances; `skip all` → `timed_out`, **no** channel post; timeout sweeper marks `timed_out`, no post |

`smoke:standup` is the keystone — it proves the entire pipeline the product depends on.

## Live smoke runbook (before shipping a phase)

Run once against a real Slack dev workspace; the stub cannot catch these:

1. Install the **poddaily** app to the dev workspace; confirm bot scopes accepted.
2. Complete a reporter user-OAuth; confirm a `slack_user_tokens` row is written.
3. Manually trigger one run (or wait for the schedule); confirm the bot DM arrives.
4. Answer all questions in Slack; confirm the **channel** post is attributed to you, renders
   the Block Kit cleanly, and threads under the opening message.
5. Confirm a `skip all` produces no channel post.
6. Note any Slack-side quirks (scope errors, rate limits, rendering) back into the spec.

## CI

`pnpm test` (unit + integration) and `pnpm smoke:phase1` run in CI against Supabase local +
a Redis service + the Slack stub — no secrets, fully deterministic. Live smoke stays manual.

## Convention for future phases

Every PRD phase adds its own `smoke:phaseN` scenarios and extends the live runbook. A phase
is not "done" until its automated smoke passes in CI **and** the live runbook has been walked
once.
