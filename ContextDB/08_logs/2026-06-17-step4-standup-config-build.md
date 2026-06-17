# 2026-06-17 — Step 4 Build: Standup Configuration

Executed the [Step 4 plan](../todos/2026-06-17-phase1-step4-standup-config-plan.md) via
subagent-driven development on branch `step4-standup-config` (shipped as a PR).

- **Schedule↔cron helpers** in `@poddaily/shared` (`WEEKDAYS`, `cronFromWeekly`,
  `parseWeeklyCron`) — TDD, handles comma-lists and ranges, round-trips.
- **Standup data-access** (`apps/web/lib/standups.ts`): `getStandup` + `upsertStandup`
  (one standup per team via `onConflictDoUpdate` on `team_id`). TDD.
- **UI** (semantic theme classes only): `/teams/[id]/standup` config page — question editor
  (add / remove / move up-down / inline-edit), schedule picker (weekday toggles + time + tz),
  intro/outro textareas — saved via a Server Action that builds the cron and upserts. A
  "Configure standup →" link added to team detail.
- **`smoke:config`** green.

## Verification
- `pnpm test`: 26 pass (added schedule 6 + standups 3 + config-smoke 1).
- `pnpm smoke:config`: green (10 tests).
- `pnpm --filter @poddaily/web build`: success.

## Scope notes
- Reorder is up/down controls (drag-and-drop is later polish).
- `smoke:config` verifies config persistence; registering the BullMQ repeatable job is Step 5
  (the scheduler doesn't exist yet).

Next: build-order step 5 — scheduler + `send-standup-dm` + DM Q&A engine (`apps/api` +
`apps/worker`, `smoke:standup`). This is the core, and the first step needing a real Slack app
for its live runbook.
