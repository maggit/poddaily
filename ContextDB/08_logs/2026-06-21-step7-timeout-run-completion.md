# 2026-06-21 — Step 7 Build: Per-Report Timeout + Event-Driven Run Completion

Executed the Step 7 plan on branch `feat/step7-timeout-run-completion`. Standup reports that a
member never finishes are now marked `timed_out` after a per-report deadline (default 4h), and a
`standup_run` is closed (`completed`) the moment all of its reports are terminal — driven by
events, not a timer. This is the **last build step of Phase 1 Core**: with Step 7, all 7 build
steps are feature-complete.

## What shipped

- **`@poddaily/db` — `finalizeRunIfDone`.** Marks a `standup_run` `completed` (sets
  `completed_at`) once every one of its reports is terminal (`completed` | `timed_out`). No-op if
  any report is still `in_progress`.
- **`timeout-report` job + handler (worker).** A per-report BullMQ job whose handler marks a
  still-`in_progress` report `timed_out`, then calls `finalizeRunIfDone`. No-op if the member
  already finished. The job delay encodes the deadline — no clock recheck.
- **`sendDm` enqueues the timeout.** When `sendDm` inserts the member's `in_progress` report it
  enqueues a `timeout-report` job delayed `STANDUP_TIMEOUT_MS` (default `14400000` = 4h,
  env-overridable, read at call time).
- **Processor dispatch.** The worker's processor dispatches the new `timeout-report` job type to
  its handler alongside the existing run/DM jobs.
- **`handleMessage` finalize (api).** On report completion the api also calls `finalizeRunIfDone`,
  so a run can close as soon as the last member finishes — without waiting for any timer.
- **`smoke:edges`.** End-to-end smoke proving timeout + completion: member A completes and
  broadcasts; member B times out and is **not** broadcast; the run ends `completed`.

## Verification

- `pnpm test`: **29 files / 114 tests passing** (unit + integration, including the Redis-backed
  smoke suites that run as part of the default `vitest` run).
- `pnpm smoke:edges`: green — A completes + broadcast, B `timed_out` + not broadcast, run
  `completed`.

## Notable decisions / scope

- **Per-report delayed job over a periodic sweeper.** Each report carries its own
  `timeout-report` job delayed to its deadline — precise per member and fully event-driven,
  rather than a periodic sweep scanning for stale rows.
- **Event-driven completion replaces the timer.** `finalizeRunIfDone` is called from both the
  timeout handler and the api on completion; there is **no separate `complete-run` timer job**.
  This replaces the earlier timer-based `complete-run` description in the scheduler docs.
- **`STANDUP_TIMEOUT_MS` read at call time** (in `sendDm`), so tests can set it small (e.g.
  `1500`) without restarting boot wiring.
- **Partials never broadcast by construction.** `timed_out` reports never reach the broadcast
  path, so there is no separate "don't broadcast" guard to maintain.
- **No new schema.** Reuses `standup_runs.status` / `completed_at` and `standup_reports.status`.
- **Retry / skip already shipped.** Retry (3× backoff) landed in 5a; skip / skip-all in 5b — not
  re-claimed here.

## Definition of done — honest status

- Automated `smoke:edges` (+ unit + integration) green in CI — ✓ (29 files / 114 tests).
- Root `README.md` updated (DM Q&A line notes the 4h timeout; `STANDUP_TIMEOUT_MS` documented in
  Configuration; Status + Roadmap reflect Phase 1 Core feature-complete) + `ContextDB/` updated
  (scheduler completion/timeout section rewritten to the event-driven model, getting-started Step 7
  note, this log) — ✓.
- **Live runbook against a real Slack dev workspace — NOT yet walked.** Walk it with a short
  `STANDUP_TIMEOUT_MS`: confirm an unanswered DM ends `timed_out` and the run closes, while a
  completed report still broadcasts. This is a pending human/operator step.

So Step 7 is **CI-green and documented, but NOT yet live-verified end-to-end**.

## Phase 1 Core

With Step 7, **all 7 build steps are feature-complete** and CI-green. The only outstanding items
are the per-phase live-runbook walks against a real Slack dev workspace — Phase 1 Core is not
considered done until those are walked.
