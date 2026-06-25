# Standup Reminders (Phase 2-B)

- **Date:** 2026-06-24
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — sub-project B
- **Motivation:** Members who get their standup DM but don't finish currently hear nothing until
  the silent 4h timeout. Recurring nudges before the timeout lift response rates. The
  `standup_reminders` table exists but is unused — this gives it a purpose.

## Summary

When a member's report clock starts, enqueue a **series of delayed `reminder` jobs** — one at each
interval up to the 4h timeout. Each fires a **DM nudge only if the member is still `in_progress`**,
mirroring the existing timeout job (fire, no-op if already done). The interval is **per-standup**,
default **60 min**; `0` disables reminders for that standup.

## Decisions locked

1. **Automatic** (not a manual "remind now" button).
2. **Recurring** — nudge at every interval until the member finishes or the run times out.
3. **Per-standup interval** — a `reminder_interval_minutes` column + a control on the config page.
4. **On by default (60 min)** — existing and new standups start with 60; `0` turns it off.
5. **DM nudge** to the member (their 1:1 DM) — not a channel ping (no public shaming).
6. **Enqueue-all-up-front** — at send time, enqueue every reminder occurrence as its own delayed
   job (no re-enqueue chain). Jobs for a member who finishes early simply no-op.

## Architecture & components

### 1. Schema + config (per-standup)
- Add `standups.reminder_interval_minutes` — `integer not null default 60` (`0` = off). Generate a
  Drizzle migration (`drizzle-kit generate`) → a new `packages/db/migrations/000N_*.sql` + meta
  snapshot. Existing rows inherit 60 via the column default.
- `apps/web/lib/standups.ts`: `StandupConfig` gains `reminderIntervalMinutes: number`;
  `upsertStandup` persists it; `getStandup` already returns the full row.
- Standup config page + `StandupForm`: one new numeric field — *"Remind unfinished members every
  ___ minutes (0 = off)"* — defaulting to the standup's value (or 60 for a new standup). The page's
  `saveAction` parses it (clamp to an integer ≥ 0) into the `upsertStandup` call.

### 2. Shared: the reminder series (pure) + job contract
- `reminderDelays(intervalMs: number, timeoutMs: number): number[]` in
  `packages/shared/src/` — returns `[intervalMs, 2·intervalMs, …]` strictly **< `timeoutMs`**.
  `intervalMs <= 0` → `[]`. Examples: `(60m, 240m) → [60m, 120m, 180m]`; `(120m, 240m) → [120m]`;
  `(0, 240m) → []`. Pure and unit-tested in isolation.
- In `packages/shared/src/queue-contract.ts` (next to `QUEUE_NAME`/`SEND_DM_JOB`/etc.):
  `export const REMINDER_JOB = "reminder";` and `export interface ReminderJob { runId: string;
  slackUserId: string; }`.

### 3. Worker: enqueue helper + handler
- `apps/worker/src/queue.ts`: `makeEnqueueReminders(queue): EnqueueReminders` where
  `EnqueueReminders = (job: ReminderJob, opts: { intervalMs: number; timeoutMs: number }) =>
  Promise<void>` enqueues one `REMINDER_JOB` per `reminderDelays(opts.intervalMs, opts.timeoutMs)`
  with `{ delay, attempts: 3, backoff: exponential 30s, removeOnComplete: true }` (same opts as the
  other jobs). `EnqueueReminders` + `ReminderJob` re-export live in `apps/worker/src/types.ts`.
- `apps/worker/src/remindReport.ts`: `remindReport({ db, slack }, job)`:
  1. Load the report by `(runId, slackUserId)`. If `status !== "in_progress"` → return (no-op).
  2. Load the run → standup (for the standup name).
  3. `openDm(slackUserId)` → post a nudge, e.g. *"👋 Reminder — you haven't finished today's
     *{standupName}* yet. Just reply here to pick up where you left off."*
  4. Best-effort insert a `standup_reminders` row `{ runId, slackUserId, type: "reminder" }`
     (observability; `sentAt` defaults now).
- `apps/worker/src/processor.ts`: build `enqueueReminders = makeEnqueueReminders(queue)`; dispatch
  `job.name === REMINDER_JOB` → `remindReport({ db, slack }, job.data)`; pass `enqueueReminders`
  into the `sendDm` and `retrigger` deps.

### 4. Enqueue sites (both report-clock starts)
- `apps/worker/src/sendDm.ts`: after enqueuing the timeout, also
  `await enqueueReminders({ runId, slackUserId }, { intervalMs: (standup.reminderIntervalMinutes ?? 0) * 60_000, timeoutMs })`
  (`standup` and `timeoutMs` are already in scope). `SendDmDeps` gains `enqueueReminders`.
- `apps/worker/src/retrigger.ts`: same call after its timeout enqueue (it already loads `standup`
  and computes `timeoutMs`). `RetriggerDeps` gains `enqueueReminders`.
- **late-join** goes through the `send-dm` job, so it is covered automatically.

### Data flow
```
member gets Q1 (sendDm) at 09:00, interval 60m, timeout 240m
  → enqueue reminder jobs at +60m, +120m, +180m  (+ timeout at +240m)
  → 10:00 reminder fires: report in_progress? yes → DM nudge + record reminder row
  → member replies, finishes at 10:30
  → 11:00 & 12:00 reminders fire: report completed → no-op
  → 13:00 timeout fires: completed → no-op
```

## Error handling
- `reminder_interval_minutes = 0` (or null) → `reminderDelays` returns `[]` → no reminder jobs.
- **At-least-once** (consistent with the rest of the system): a rare BullMQ retry could double-send
  a nudge — harmless for a reminder. The `standup_reminders` write is best-effort (failure logged,
  swallowed; never blocks the nudge).
- A nudge for a member whose report was deleted / run finalized: the `status !== "in_progress"`
  guard makes it a no-op.
- **Config changed mid-run** applies to **future** runs; reminders already enqueued for an open run
  keep the interval they were created with.

## Testing
- **`reminderDelays`** pure unit (shared): the series for a typical interval; `0`/negative → `[]`;
  the strict `< timeout` boundary (`(120m,240m) → [120m]`, not `[120m,240m]`).
- **`remindReport`** worker unit (real PG + fake slack): `in_progress` → posts a nudge + writes a
  `standup_reminders` row; `completed` and `timed_out` → no post, no row.
- **`sendDm`** unit: enqueues the reminder series matching `reminderDelays` for the standup's
  interval (assert via an injected `enqueueReminders` spy); `interval 0` → no reminder enqueue.
- **Web**: `upsertStandup` round-trips `reminderIntervalMinutes` (extend `standups.test.ts`).
- **Optional (not gating)**: a smoke with a short interval asserting a nudge DM lands in the stub
  while a member is outstanding, and not after they complete.
- Full `pnpm test` green.

## Definition of done
1. New unit tests + full `pnpm test` green in CI; the new migration applies cleanly.
2. README: a "Reminders" note (per-standup interval, default 60, `0` = off; DM nudges until
   finished/timed-out). ContextDB: a build log.
3. No Slack config change. `reminder_interval_minutes` migration is the only schema change.

## Files (anticipated)
```
packages/db/src/schema.ts (+ migrations/000N_*.sql + meta)   # reminder_interval_minutes
packages/shared/src/reminders.ts (+ test)                    # reminderDelays
packages/shared/src/queue-contract.ts                        # REMINDER_JOB + ReminderJob
apps/worker/src/types.ts                                     # EnqueueReminders + re-exports
apps/worker/src/queue.ts                                     # makeEnqueueReminders
apps/worker/src/remindReport.ts (+ test)                     # the reminder handler
apps/worker/src/processor.ts                                 # dispatch + wire deps
apps/worker/src/sendDm.ts                                    # enqueue reminders
apps/worker/src/retrigger.ts                                 # enqueue reminders
apps/web/lib/standups.ts (+ standups.test.ts)                # reminderIntervalMinutes in config
apps/web/components/standups/standup-form.tsx                # interval field
apps/web/app/(dashboard)/teams/[id]/standup/page.tsx         # parse + pass the field
README.md · ContextDB/08_logs/2026-06-24-reminders.md        # DoD
```
