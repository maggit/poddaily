# 2026-06-24 — Standup reminders (Phase 2-B)

Phase 2 sub-project B. Members who get their standup DM but don't finish now receive recurring DM
nudges until they complete or time out — giving the long-unused `standup_reminders` table a
purpose. Spec:
[2026-06-24-reminders-design.md](../../docs/superpowers/specs/2026-06-24-reminders-design.md).
Plan: [2026-06-24-reminders.md](../../docs/superpowers/plans/2026-06-24-reminders.md).

## What shipped

- **`standups.reminder_interval_minutes`** — `integer not null default 60` (`0` = off); migration
  `0003_little_nomad.sql`. Existing standups inherit 60.
- **`reminderDelays(intervalMs, timeoutMs)`** (`@poddaily/shared`, pure + tested) — the fire-times,
  every interval strictly `< timeout`. `(60m, 240m) → [60m,120m,180m]`; `0`/`>=timeout` → `[]`.
- **`reminder` job** (`REMINDER_JOB` + `ReminderJob` in shared) handled by
  `apps/worker/src/remindReport.ts`: DM-nudges the member **only if their report is still
  `in_progress`** (mirrors the timeout job's no-op-if-done), then records a `standup_reminders` row.
- **Enqueue-all-up-front** — `makeEnqueueReminders` enqueues one `reminder` job per
  `reminderDelays(standup.reminderIntervalMinutes·60000, STANDUP_TIMEOUT_MS)`. Called wherever a
  report's timeout is enqueued: **`sendDm`** and **`retrigger`** (late-join goes through `send-dm`,
  so it's covered). Jobs for a member who finishes early just no-op.
- **Config UI** — a per-standup *"Reminder interval (minutes, 0 = off)"* field on the standup
  config page; `StandupConfig`/`upsertStandup`/`getStandup` carry `reminderIntervalMinutes`.

## Verification

- `pnpm test` — **153 passed / 153** (36 files), 0 failures (migration applied first; reminders
  don't run in the short-timeout smokes since `reminderDelays(60m, 1.5s) → []`).
- New tests: `reminderDelays` pure unit (boundary + off); `remindReport` worker unit
  (`in_progress` → nudge + reminder row; `completed`/`timed_out` → no-op); `sendDm` enqueues the
  series at the standup's interval; web `upsertStandup` round-trips `reminderIntervalMinutes`.
- The outbound smoke exercises `sendDm` (now incl. the reminder enqueue) through the real processor.

## Notable decisions

- **Automatic + recurring** (not a manual "remind now" button; nudge every interval until done/timeout).
- **Per-standup interval, default 60 min** (on by default; `0` disables per standup).
- **Enqueue-all-up-front**, not a re-enqueue chain — simpler, self-cleaning via the in_progress guard.
- **DM nudge** (member's 1:1 DM), not a channel ping — no public shaming.
- **At-least-once** (consistent with the rest): a rare BullMQ retry could double-nudge — harmless;
  the `standup_reminders` write is best-effort.
- **Config changes apply to future runs** — reminders already enqueued for an open run keep their
  original interval.
- `reminderIntervalMinutes` is optional in `StandupConfig` (defaults to 60 in `upsertStandup`) so
  existing callers compile; the config page always sends an explicit value.

## Definition of done

1. New unit tests + full `pnpm test` green; migration `0003` applies cleanly.
2. README "Reminders" note ✅; this build log ✅.
3. No Slack config change; the single schema change is `reminder_interval_minutes`.
4. **Deploy:** run the DB migration (`0003_little_nomad.sql`) on the prod database.

## Backlog after this

Phase 2 remaining: **D — RBAC tiers** (role-gated admin access). With B shipped, A/B/C of Phase 2
are done plus the re-trigger and late-join extras. See [phase-2-backlog.md](../todos/phase-2-backlog.md).
