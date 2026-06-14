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
| [PRD](../01_specs/poddaily-prd.md) | Full product requirements (source of truth for scope) |
| [Phase 1 Core spec](../01_specs/phase-1-core-spec.md) | The validated design we're building first |
| [System overview](../02_architecture/system-overview.md) | Monorepo, services, runtime topology |
| [Data model](../02_architecture/data-model.md) | Postgres schema (Drizzle) + deltas from PRD |
| [Slack integration](../02_architecture/slack-integration.md) | Three OAuth surfaces, DM engine, broadcast |
| [Scheduler](../02_architecture/scheduler.md) | Per-user-TZ BullMQ scheduling |

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [Post as user via user tokens](../03_decisions/2026-06-14-post-as-user-tokens.md) | Reports posted as the actual Slack user, not a bot override |
| [Per-user local timezone](../03_decisions/2026-06-14-per-user-timezone.md) | Each member is DM'd at their own local time |
| [New Slack app "poddaily"](../03_decisions/2026-06-14-new-slack-app.md) | Fresh Slack app with committed manifest |
| [Supabase as managed Postgres](../03_decisions/2026-06-14-supabase-as-database.md) | Supabase for DB only; NextAuth for auth |
| [Vertical-slice build order](../03_decisions/2026-06-14-vertical-slice-build.md) | Build one feature end-to-end first |
| [Stateless DM state](../03_decisions/2026-06-14-stateless-dm-state.md) | Reconstruct conversation state from Postgres |

## Diagrams

- [Architecture](../07_diagrams/architecture.mmd.md)
- [DM state machine](../07_diagrams/dm-state-machine.mmd.md)
- [Scheduler flow](../07_diagrams/scheduler-flow.mmd.md)

## Logs

- [2026-06-14 planning session](../08_logs/2026-06-14-planning-session.md)

## Scope at a glance

**Phase 1 Core (this spec):** Slack OAuth admin auth · team CRUD · member management ·
standup config · per-user-TZ scheduler · conversational DM Q&A · channel broadcast as the user.

**Deferred:** today's dashboard & participation stats, one-click reminders, pause/resume UX
(Phase 2); analytics, slash command, Databricks webhook, streaks (Phase 4 / P1);
multi-standup, polls, AI summary, OOO detection (P2).
