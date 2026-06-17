# poddaily — Project Map

Entry point for poddaily context. poddaily is a self-hosted, Slack-native daily standup
bot plus an internal admin platform — an open-source replacement for hosted SaaS standup
tools that runs on internal infrastructure with no per-seat cost.

## Status

- **Phase:** Phase 1 — Core (specced, not yet implemented)
- **Owner:** Raquel Hernandez, VP Engineering
- **Planning date:** 2026-06-14

## Start here

| Document | What it is |
|---|---|
| [Getting Started](getting-started.md) | From-zero runbook to run & test locally (Supabase, Slack app, env vars, smoke) |
| [PRD](../01_specs/poddaily-prd.md) | Full product requirements (source of truth for scope) |
| [Phase 1 Core spec](../01_specs/phase-1-core-spec.md) | The validated design we're building first |
| [System overview](../02_architecture/system-overview.md) | Monorepo, services, runtime topology |
| [Data model](../02_architecture/data-model.md) | Postgres schema (Drizzle) + deltas from PRD |
| [Slack integration](../02_architecture/slack-integration.md) | Three OAuth surfaces, DM engine, broadcast |
| [Scheduler](../02_architecture/scheduler.md) | Per-user-TZ BullMQ scheduling |
| [Testing & local dev](../02_architecture/testing-and-local-dev.md) | Local setup, per-phase smoke tests, Slack stub, live runbook |
| [Design direction](../04_knowledge/design-direction.md) | UI/UX system (Resend + Steady + reference-layout synthesis) — source of truth for all UI |

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [Post as user via user tokens](../03_decisions/2026-06-14-post-as-user-tokens.md) | Reports posted as the actual Slack user, not a bot override |
| [Per-user local timezone](../03_decisions/2026-06-14-per-user-timezone.md) | Each member is DM'd at their own local time |
| [New Slack app "poddaily"](../03_decisions/2026-06-14-new-slack-app.md) | Fresh Slack app with committed manifest |
| [Supabase as managed Postgres](../03_decisions/2026-06-14-supabase-as-database.md) | Supabase for DB only; NextAuth for auth |
| [Vertical-slice build order](../03_decisions/2026-06-14-vertical-slice-build.md) | Build one feature end-to-end first |
| [Stateless DM state](../03_decisions/2026-06-14-stateless-dm-state.md) | Reconstruct conversation state from Postgres |
| [E2E smoke via Slack stub](../03_decisions/2026-06-14-e2e-smoke-with-slack-stub.md) | Per-phase smoke test with a stubbed Slack + live checklist |

## Diagrams

- [Architecture](../07_diagrams/architecture.mmd.md)
- [DM state machine](../07_diagrams/dm-state-machine.mmd.md)
- [Scheduler flow](../07_diagrams/scheduler-flow.mmd.md)

## Implementation plans (`todos/`)

Phase 1 Core is built as a vertical slice of 7 demoable steps; one plan per step, authored
just-in-time so each reflects what the prior step produced.

- ✅ [Step 1 — Foundation](../todos/2026-06-14-phase1-step1-foundation-plan.md) — **DONE** (merged `c540192`): monorepo, db, shared, local infra, `smoke:db`.
- ✅ [Step 2 — Slack manifest + admin NextAuth login](../todos/2026-06-15-phase1-step2-auth-plan.md) — **DONE** (merged `d804e4f`): `apps/web`, Slack OIDC login, route protection, `tools/slack-stub`, `smoke:auth`.
- ✅ Step 3 — team create + add member (captures TZ) (`smoke:team`). [Design direction](../04_knowledge/design-direction.md) (indigo accent), [admin-CRUD ADR](../03_decisions/2026-06-16-admin-crud-via-next-server.md).
  - ✅ Part 1 — design system + app shell + login restyle — **DONE** (merged `2e4df1a`).
  - ✅ Part 2 — team/member CRUD via Next server-side — **DONE** (merged PR #2, `7292ec0`).
- 🚧 [Step 4 — standup configuration](../todos/2026-06-17-phase1-step4-standup-config-plan.md) (questions + schedule + intro/outro, `smoke:config`) — in PR.
- 🚧 Step 5 — scheduler + `send-standup-dm` + DM Q&A engine (`apps/api` + `apps/worker`, `smoke:standup`) — the core; next.
- Steps 6–7 — authored before each is executed.

## Logs

- [2026-06-14 planning session](../08_logs/2026-06-14-planning-session.md)

## Scope at a glance

**Phase 1 Core (this spec):** Slack OAuth admin auth · team CRUD · member management ·
standup config · per-user-TZ scheduler · conversational DM Q&A · channel broadcast as the user.

**Deferred:** today's dashboard & participation stats, one-click reminders, pause/resume UX
(Phase 2); analytics, slash command, Databricks webhook, streaks (Phase 4 / P1);
multi-standup, polls, AI summary, OOO detection (P2).
