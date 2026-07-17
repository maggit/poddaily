# ADR: On-Demand Schedule Reconciliation, Manual Trigger, and Standup Health View

- **Date:** 2026-07-17
- **Status:** Accepted

## Context

A standup created for a new team from the admin web **never fired**. Root cause:
`reconcileSchedules` (which registers a BullMQ job scheduler per active standup) only ran at
**worker boot**. A standup created *after* the worker booted got no scheduler and silently
never triggered until the next deploy. There was also no way to send a standup on demand and
no operator-facing view to notice a standup had missed its run.

## Decisions

### 1. Reconcile schedules on standup writes, not just at boot

The web app enqueues a `reconcile-schedules` job (`enqueueScheduleReconcile`) after any standup
create / update / pause / resume; the worker processor re-runs `reconcileSchedules` on that job.
A repeatable `reconcile-schedules` job every 15 minutes (`RECONCILE_EVERY_MS`) is a self-healing
safety net if an on-demand enqueue is ever dropped. This makes new/edited standups take effect
without a worker restart. See [scheduler.md](../02_architecture/scheduler.md#schedule-change-reconciliation).

**Rejected:** having the web write BullMQ schedulers directly. The worker owns all scheduler
state; routing through a job keeps that ownership single-writer and avoids duplicating the
`deriveTickCron`/diff logic in the web process.

### 2. Manual trigger via a `force` flag on `open-run`

Rather than a new job type, manual trigger reuses `open-run` with `{ force: true }`. `force`
bypasses the weekday guard, sends every DM immediately (delay 0), and re-fans-out on an
already-open run. Safety rests on the existing `sendDm` idempotency (`(run_id, slack_user_id)`
short-circuit), so re-triggering only fills gaps and never double-DMs. A paused standup still
no-ops. Exposed from the admin web ("Trigger now" + a send-on-save checkbox), guarded by
`requireTeamEdit`, and from the CLI (`worker trigger <id> --force`).

**Rejected:** reusing the DM-keyword `retrigger` path. `retrigger` is per-member and resets a
timed-out report; the operator need is a whole-team send, which `open-run` already models.

### 3. Standup health view derived from run/report state

`apps/web/lib/health.ts#getStandupHealth` returns one row per team: latest run, per-status
report counts (DMs sent vs. reported vs. timed out), the derived health state, and the next
scheduled run. State is **derived**, not stored — a scheduled day whose send time has passed
with no run row surfaces as **`missed` ("Did not trigger")**, which is exactly the failure this
work was reported for. No new tables; it reads `standup_runs` + `standup_reports`.

## Consequences

- New standups fire without a redeploy; a missed run is now visible and one-click recoverable.
- `nextRunInstant` added to `packages/shared` (pure, unit-tested) powers the "next run" column.
- Queue contract gains `OPEN_RUN_JOB`, `OpenRunJob`, `RECONCILE_JOB`, and reconcile scheduler
  constants.
