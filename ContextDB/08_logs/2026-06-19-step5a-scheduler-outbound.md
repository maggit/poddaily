# 2026-06-19 — Step 5a Build: Scheduler + Outbound Standup DM

Executed the [Step 5a plan](../../docs/superpowers/plans/2026-06-17-step5a-scheduler-outbound-dm.md)
via subagent-driven development on branch `feat/step5a-scheduler-outbound-dm` (shipped as
[PR #11](https://github.com/maggit/poddaily/pull/11)).

## What shipped

- **`apps/worker`** — BullMQ worker that runs the per-user-timezone scheduler and sends
  outbound standup DMs. Includes the BullMQ job scheduler (one per active standup, keyed by
  standup id), `openRun` (idempotent run open + member fan-out), `sendDm` (opens DM, posts
  intro if set + Q1 with `{last_report_date}` interpolated, inserts `in_progress` report),
  and a `trigger <standupId>` CLI for manual runs.
- **`packages/slack-client`** — thin `@slack/web-api` wrapper (`openDm`, `postMessage`) with
  a `SLACK_API_BASE_URL` env seam so tests/smoke can point the client at the local Slack stub.
- **`tools/slack-stub` extended** — now fakes `conversations.open` and `chat.postMessage`
  with a recorder; prior stub only handled auth/OAuth surfaces.
- **`packages/shared`** — pure per-user-TZ send-instant math (Luxon): `computeSendInstant`,
  `anchorDate`, `isActiveWeekday`, `deriveTickCron`. Unit-tested independently of BullMQ,
  including DST boundaries.
- **DB migration** — `standup_runs.scheduled_date` column added; unique constraint on
  `(standup_id, scheduled_date)`; unique constraint on `(run_id, slack_user_id)` on
  `standup_reports`.
- **`smoke:standup-outbound`** — integration smoke: boots a real BullMQ queue+worker against
  local Redis + the Slack stub, triggers a run, asserts DMs sent and `standup_reports` rows
  created as `in_progress`.

## Verification

- `pnpm test`: **16 files / 56 tests passing** (includes unit tests for shared math, DB
  schema, slack-client, and the full `smoke:standup-outbound` suite).
- `pnpm smoke:standup-outbound`: green — BullMQ queue+worker boots, trigger fires, stub
  records `conversations.open` + `chat.postMessage`, `standup_reports` row confirmed
  `in_progress`.

## Notable decisions / fixes during build

**Canonical TZ anchor.** A run is anchored on calendar date D in the standup's `scheduleTz`.
Active-weekday check happens once in `scheduleTz` at tick time. Each member's DM fires at
their own local configured time on date D. This is the locked rule; see
[scheduler.md](../02_architecture/scheduler.md#locked-decisions-implemented-in-5a).

**BullMQ Job Schedulers API — scheduler id on `.key`, not `.id`.** The BullMQ repeatable job
scheduler returns the scheduler id on `.key` (not `.id`); the reconcile/remove logic uses
`.key` to look up the existing scheduler for a standup. Discovered during implementation;
`.id` is undefined.

**`prepare: false` pooler — seed jsonb via `JSON.stringify`, not `sql.json`.**
`packages/db` uses `prepare: false` for the Supabase transaction-mode pooler. When seeding
jsonb columns (e.g. `questions`), the value must be passed as `JSON.stringify(value)` rather
than `sql.json(value)` — the latter tries to bind a parameterized placeholder that the
no-prepare driver does not support.

**`pnpm test` now requires Redis.** The `smoke:standup-outbound` suite runs as part of the
default `vitest` run (not just a separate `pnpm smoke:*` command). This is a conscious
decision, consistent with the project's existing policy of requiring Postgres for `pnpm test`.
Local dev: `docker compose up -d redis` before running tests.

## Operator note

Redis is a new runtime dependency (BullMQ). It is already in `docker-compose.yml` for local
dev. Production deployment of `apps/worker` + Redis to Dokploy is **deferred to Step 5b**,
where it will be bundled with `apps/api` and the inbound DM Q&A engine.

## Out of scope (not done in 5a)

- Inbound DM Q&A engine + `apps/api` → Step 5b.
- Channel broadcast / post-as-user → Step 6.
- Complete-run + 4h timeout sweeper + skip/skip-all → Step 7.
- Production deploy of worker + Redis to Dokploy → bundled with Step 5b.

Next: Step 5b — `apps/api` + inbound `message.im` Q&A engine + `smoke:standup`.
