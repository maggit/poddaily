# Step 7 — Timeout Sweep + Run Completion Design

- **Date:** 2026-06-20
- **Status:** Accepted (brainstorming)
- **Phase:** 1 Core, build step 7 (final step)
- **Predecessor:** [Step 6b — reporter user-OAuth](../../../ContextDB/08_logs/2026-06-20-step6b-reporter-user-oauth.md)

## Summary

A standup report that a member never finishes currently sits `in_progress` forever, and a
`standup_run` opened as `running` is never closed. Step 7 adds the missing lifecycle close-out:

- **Timeout:** each member's report is given **4 hours** from when their DM started; if it's
  still `in_progress` when that elapses, it's marked `timed_out` (and, being non-`completed`, is
  never broadcast to the channel).
- **Run completion:** a run is marked `completed` once **all** its reports are terminal
  (`completed | timed_out`).

This completes Phase 1 Core. **No new schema** — `standup_runs.status`/`completed_at` and
`standup_reports.status='timed_out'` already exist.

## Scope

**In scope:** a per-report `timeout-report` delayed job + handler; a `finalizeRunIfDone` helper;
wiring in `sendDm` (enqueue the timeout) and `handleMessage` (finalize on completion); `smoke:edges`.

**Already shipped (no work here):**
- **Retry** — `send-dm` jobs retry 3× with exponential backoff (`apps/worker/src/queue.ts`);
  persistent failures land in the BullMQ failed set. (Step 5a.)
- **Skip / skip-all** — `skip` records "(skipped)" and advances; `skip all` aborts the report to
  `timed_out`. (Step 5b.)

**Out of scope (deferred):** member reminders (the `standup_reminders` table exists but is unused
→ Phase 2); any channel "run closed" summary post (YAGNI); a global safety sweeper for orphaned
rows (the per-report job is precise; revisit only if orphans appear in practice).

## Decision: per-report delayed job + event-driven completion

Chosen over a periodic sweeper because members are DM'd at different times across the day
(per-timezone), so a single per-run timer can't honour each member's own 4 hours. A delayed job
enqueued per report fires exactly 4h after **that** member's DM, event-driven (no polling), and
matches how `sendDm` already enqueues delayed per-member jobs. Run completion is then a shared
`finalizeRunIfDone` check triggered from both terminal transitions — **no separate `complete-run`
timer job** (this consolidates the two pieces the [scheduler doc](../../../ContextDB/02_architecture/scheduler.md#completion--timeout)
described into one event-driven path; that doc will be updated).

## Architecture & components

### 1. `timeout-report` job — enqueued by `sendDm`

When `sendDm` inserts the `in_progress` report, it also enqueues a `timeout-report` job. The job
payload is `{ runId, slackUserId }`, delayed `TIMEOUT_MS`.

- `TIMEOUT_MS` = `Number(process.env.STANDUP_TIMEOUT_MS ?? 4 * 60 * 60 * 1000)` (4h default;
  env-overridable so tests/smoke don't wait 4h). Lives as a small constant in `apps/worker`.
- `SendDmDeps` gains `enqueueTimeout(job: TimeoutJob, opts: { delayMs: number })`, wired from the
  queue in the processor (mirroring `enqueueSend`). `TimeoutJob = { runId, slackUserId }`.
- The enqueue happens after the report insert; it's part of the same at-least-once send path, so
  a BullMQ retry of `send-dm` may enqueue a duplicate timeout job — harmless, the handler is
  idempotent (acts only on `in_progress`).

### 2. `timeout-report` handler — `apps/worker/src/timeoutReport.ts`

```
timeoutReport(deps: { db }, job: { runId, slackUserId }):
  load the report for (runId, slackUserId)
  if not found → return
  if status !== 'in_progress' → return        // member answered or skip-all'd in time
  set status = 'timed_out'
  await finalizeRunIfDone(db, runId)
```

The delay encodes the 4h, so the handler needs no elapsed-time recheck — firing means 4h passed.
Idempotent and retry-safe (a second fire finds the report already terminal → no-op).

### 3. `finalizeRunIfDone(db, runId)` — `packages/db/src/runs.ts`

```
finalizeRunIfDone(db, runId):
  load the run
  if not found or run.status === 'completed' → return
  load all standup_reports for the run
  if every report.status ∈ {completed, timed_out}  (and there is ≥0)
     → update run set status='completed', completed_at=now where id=runId and status != 'completed'
```

- Idempotent: the `status != 'completed'` guard + the early return make concurrent calls (timeout
  job and `handleMessage` completing the last report at nearly the same moment) converge to one
  completion.
- **Zero-report run** (run opened but no members fanned out): vacuously all-terminal → completed
  immediately. Acceptable.
- Re-exported from `@poddaily/db` so both the worker (timeout handler) and the api (`handleMessage`)
  can call it.

### 4. Wiring the two terminal transitions to finalize

- **Timeout** → handler calls `finalizeRunIfDone` (above).
- **Completion** → `handleMessage`'s `complete` branch, **after** `broadcastReport`, calls
  `finalizeRunIfDone(db, run.id)`. (Best-effort: wrap so a finalize failure never reverts the
  completed report — consistent with the broadcast's isolation.)

### 5. Partials are never broadcast — by construction

A `timed_out` report never reaches `handleMessage`'s `complete` branch, so `broadcastReport` never
runs for it. The opening-message counter (`reported` = count of `completed` reports) already
excludes `timed_out`, so a run with a timeout shows an accurate final count (e.g. "2 out of 3") —
no counter update is needed on timeout.

### 6. Processor wiring

`createProcessor` dispatches the new `timeout-report` job name to `timeoutReport`, and provides
`sendDm` with `enqueueTimeout` (built from the queue, like `makeEnqueueSend`).

## Data flow

```
sendDm → insert in_progress report → enqueue timeout-report (delay = TIMEOUT_MS)
                         │
   member completes (api handleMessage) → report 'completed' → broadcast → finalizeRunIfDone
                         │  (OR)
   4h elapses → timeout-report job → report still in_progress? → 'timed_out' → finalizeRunIfDone
                         │
   finalizeRunIfDone → all reports terminal? → run 'completed' + completed_at
```

## Error handling

- `timeout-report` retries 3× (backoff) like other jobs; idempotent (only acts on `in_progress`),
  so retries/redeliveries are safe.
- `finalizeRunIfDone` is idempotent and guarded; a failure is logged but never reverts a report's
  terminal status (best-effort, consistent with the broadcast contract).
- A duplicate timeout job (from a `send-dm` retry) is a no-op once the report is terminal.

## Testing

- **Unit (integration, real PG):** `finalizeRunIfDone` — all-terminal → run `completed`; some
  `in_progress` → no-op; already `completed` → no-op; zero-report run → `completed`.
- **Unit (integration, real PG):** `timeoutReport` — `in_progress` → `timed_out` + run finalized;
  already-`completed`/`timed_out` report → no-op (and not re-broadcast).
- **`smoke:edges` (new):** real Redis + PG + stub. (a) Open a run, DM a member (`in_progress`),
  fire the timeout (short `STANDUP_TIMEOUT_MS` or enqueue the job directly) → assert the report is
  `timed_out`, **no channel post for it**, run `completed`. (b) Mixed: two members; one completes
  (broadcast happens), one times out → run `completed`, only the completer broadcast, counter
  shows "1 out of 2".

## Definition of done (per phase)

1. `smoke:edges` green in CI, plus the unit tests.
2. **Live runbook walked once:** confirm a never-answered standup DM ends up `timed_out` and the
   run closes; confirm a completed report still broadcasts. (Practical note: set a short
   `STANDUP_TIMEOUT_MS` for the live walk so it doesn't take 4h, then restore 4h.)
3. Root `README.md` updated — tick the timeout/edges feature item(s); document `STANDUP_TIMEOUT_MS`.
4. `ContextDB/` updated: the [scheduler doc](../../../ContextDB/02_architecture/scheduler.md)
   "Completion & timeout" section rewritten to the event-driven model; getting-started note;
   build log. **Phase 1 Core marked complete.**

## Files (anticipated)

```
apps/worker/src/types.ts                    # + TimeoutJob, EnqueueTimeout; SendDmDeps gains enqueueTimeout
apps/worker/src/queue.ts                    # + makeEnqueueTimeout (timeout-report job, delay, retries)
apps/worker/src/sendDm.ts (+ test)          # enqueue timeout-report after the report insert
apps/worker/src/timeoutReport.ts (+ test)   # the timeout handler
apps/worker/src/processor.ts                # dispatch timeout-report; provide enqueueTimeout to sendDm
packages/db/src/runs.ts (+ test)            # finalizeRunIfDone
packages/db/src/index.ts                    # re-export finalizeRunIfDone
apps/api/src/handleMessage.ts (+ test)      # call finalizeRunIfDone after broadcast on complete
apps/worker/tests/edges-smoke.test.ts       # smoke:edges
package.json                                # + smoke:edges script
README.md · ContextDB/* · build log         # DoD + Phase 1 complete
```
