# Scheduler

How poddaily decides *when* to DM each member. Driven by the
[per-user-timezone ADR](../03_decisions/2026-06-14-per-user-timezone.md). See the
[scheduler flow diagram](../07_diagrams/scheduler-flow.mmd.md).

## Components

- **BullMQ + Redis** — repeatable jobs and per-member send jobs.
- **`worker/scheduler.ts`** — reconciles repeatable jobs with the set of active standups.
- **Jobs:** `send-standup-dm`, `complete-run`, and a timeout sweeper.

## Repeatable job per standup

For each `is_active` standup there is exactly one BullMQ **repeatable job**, keyed by
standup id. It is (re)created/removed whenever the standup's schedule or active state
changes — the scheduler reconciles on standup config writes and on worker boot.

The repeatable job's cadence is the **earliest** member send time across timezones for the
standup's configured local time + weekdays, OR a simple daily tick on active weekdays that
then computes per-member offsets. The job's responsibility is to **open the run**, not to DM
everyone simultaneously.

## Run open → per-member fan-out

When the repeatable job fires for a standup on an active weekday:

1. Call `POST /internal/runs/start/:standupId` → creates a `standup_run` (`status=running`,
   `scheduled_at`).
2. For each member with `can_report = true`:
   - Resolve the member's timezone (`team_members.timezone`, fallback `standups.schedule_tz`).
   - Compute the member's **local send instant** for the standup's configured time today.
   - If that instant is now-or-past (within tolerance) → enqueue `send-standup-dm` immediately;
     if it's later today → enqueue it `delayed` until that instant.
3. Each `send-standup-dm` job opens the DM and starts the Q&A (see
   [slack integration](slack-integration.md#dm-qa-engine)).

This means a single run can DM members across the day as each member's local time arrives,
rather than one global fire.

## Retry

`send-standup-dm` retries **3× with exponential backoff** on Slack send failure. Persistent
failures land in the BullMQ failed set (delivery-success metric is tracked from this).

## Completion & timeout

- **`complete-run`** — enqueued to finalize the run after the day's send window; sets the
  run `completed`.
- **Timeout sweeper** — any `standup_reports` row still `in_progress` 4 hours after its DM
  started is marked `timed_out`; such partials are never broadcast.

## Schedule-change reconciliation

Editing a standup's `schedule_cron`, `schedule_tz`, or `is_active` triggers the scheduler to
remove and recreate that standup's repeatable job so the next run reflects the new config.

## Pure, testable core

The per-member local-send-instant computation (cron + IANA tz + "today") is a **pure
function** in `packages/shared` and is unit-tested independently of BullMQ — including DST
boundaries and members in different zones.

## Locked decisions (implemented in 5a)

These rules are implemented and frozen — they are the canonical behaviour for the scheduler.

**Canonical date anchor.** A run is anchored on calendar date D in the standup's
`scheduleTz`. "Is today an active weekday?" is evaluated once in `scheduleTz` at tick time.
Each member is then DM'd at their own local configured time on that same date D, regardless
of what the UTC wall-clock shows in their timezone.

**Derived tick cron (00:05 in `scheduleTz`).** The BullMQ job scheduler fires at **00:05 in
the standup's `scheduleTz`** on active weekdays. The tick cron is derived from the standup's
`schedule_cron` — same weekday expression, time overridden to `00:05`. One BullMQ repeatable
"job scheduler" exists per active standup, keyed by standup id.

**Idempotency constraints.**
- `standup_runs (standup_id, scheduled_date)` — unique; opening a run for a given standup on
  a given date is idempotent (subsequent ticks on the same day are no-ops).
- `standup_reports (run_id, slack_user_id)` — unique; fan-out jobs that fire more than once
  for the same member + run cannot double-insert a report.
