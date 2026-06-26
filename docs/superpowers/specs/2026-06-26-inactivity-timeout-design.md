# Inactivity-Based Standup Timeout (bug fix)

- **Date:** 2026-06-26
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — bug fix (Phase 1 carryover)
- **Motivation:** A member who answers questions over a span of hours gets cut off mid-conversation.
  The bot goes "stale" — their next reply is silently ignored.

## The bug

The per-report timeout is a **fixed deadline anchored to when the standup DM was sent**, and it is
**never reset when the member replies**:
- `sendDm` enqueues a `timeout-report` job with `delay = STANDUP_TIMEOUT_MS` (default 4h) from send
  time ([apps/worker/src/sendDm.ts](../../apps/worker/src/sendDm.ts)).
- `handleMessage`'s `next` branch only saves the answer + posts the next question — it never
  re-arms the timeout ([apps/api/src/handleMessage.ts](../../apps/api/src/handleMessage.ts)).
- When the job fires, `timeoutReport` marks the report `timed_out` if it's still `in_progress` —
  **even mid-conversation** ([apps/worker/src/timeoutReport.ts](../../apps/worker/src/timeoutReport.ts)).
- Once `timed_out`, `handleMessage`'s opening query (`status = 'in_progress'`) finds nothing, so
  the member's next reply is not recognized as an answer → silently dropped ("stale bot").

So the effective answering window is `(send_time + TIMEOUT) − (when the member started)`, which can
be far less than the full timeout for anyone who opens the DM a few hours after it arrives.

## Fix — inactivity reset

Make the timeout measure **silence**, not elapsed-since-send: every reply resets the clock to the
full `STANDUP_TIMEOUT_MS`. Implemented with an absolute deadline stored on the report (`timeout_at`)
that is bumped on each answer, and a timeout handler that **re-schedules itself** when it fires
early (i.e. the member has replied since it was enqueued).

### Decisions locked
1. **Inactivity reset** — timed out only after a full `STANDUP_TIMEOUT_MS` of *no replies*.
2. **Global env** — the duration stays `STANDUP_TIMEOUT_MS`; the **api reads it too** (no per-standup
   column).
3. **Self-rescheduling handler** — one timeout job per report; the api only writes `timeout_at`
   (it does not enqueue timeout jobs).

## Architecture & components

### 1. Schema
- Add `standup_reports.timeout_at` — `timestamp with time zone`, **nullable** (existing in-flight
  rows have no recorded deadline). Drizzle migration via `drizzle-kit generate`.

### 2. Set / bump `timeout_at` (3 touch points)
- **`apps/worker/src/sendDm.ts`** — when inserting the `in_progress` report, set
  `timeoutAt: new Date(Date.now() + timeoutMs)` (`timeoutMs` is already computed there).
- **`apps/worker/src/retrigger.ts`** — same, in both the insert and the `onConflictDoUpdate` reset
  `set` (so a re-triggered report gets a fresh deadline). `timeoutMs` is already computed there.
- **`apps/api/src/handleMessage.ts`**, the `next` branch — add `timeoutAt: new Date(Date.now() +
  timeoutMs)` to the report `update().set(...)` alongside `answers`. The api computes
  `timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS)` at call time (same pattern
  and default as `sendDm`). This is the inactivity reset; **the api does not enqueue anything here.**

### 3. Self-rescheduling `timeoutReport` (`apps/worker/src/timeoutReport.ts`)
Change the handler to re-read `timeout_at` and reschedule when the deadline has moved out:
1. Load `status` + `timeoutAt`.
2. `status !== "in_progress"` → no-op (unchanged).
3. `timeoutAt` is set **and** `Date.now() < timeoutAt` → the member replied since this job was
   enqueued; **re-enqueue this same timeout job** with `delayMs = Math.max(0, timeoutAt − now)` and
   return (do NOT time out).
4. Otherwise (deadline reached, or `timeoutAt` null for a legacy row) → mark `timed_out` +
   `finalizeRunIfDone` (unchanged).

`timeoutReport` gains an `enqueueTimeout` dependency (the processor already builds
`makeEnqueueTimeout(queue)` — pass it in). `TimeoutReportDeps` becomes `{ db, enqueueTimeout }`.

### 4. Processor wiring
- `apps/worker/src/processor.ts`: pass `enqueueTimeout` into the `timeoutReport(...)` call.

### Data flow
```
DM sent 09:00, TIMEOUT 4h → report.timeout_at = 13:00, one timeout job enqueued (fires ~13:00)
member answers Q1 at 11:00 → handleMessage bumps timeout_at = 15:00 (no enqueue)
timeout job fires ~13:00 → now(13:00) < timeout_at(15:00) → re-enqueue for +2h (fires ~15:00)
  ├─ member answers again 14:30 → timeout_at = 18:30
  │    job fires ~15:00 → now < 18:30 → re-enqueue +3.5h … (repeats per reply)
  └─ member silent → job fires ~15:00 → now ≥ 15:00 → timed_out + finalize
```

## Error handling & edges
- **Legacy rows** (`timeout_at` null): step 4 times them out (today's behavior) — never stuck.
- **Race at the deadline** (job fires the instant a reply lands): reply-commits-first → reschedule;
  job-commits-first → timed_out and the late reply is dropped. The window is tiny and only at the
  far edge of an *inactivity* deadline (nowhere near active typing) — a vast improvement over the
  current guaranteed mid-conversation cutoff. Not worth locking for v1.
- **No infinite loop:** reschedule delay is `max(0, timeout_at − now)`; once `now ≥ timeout_at` the
  handler times out instead of rescheduling.
- **Reschedule enqueue fails** (Redis blip): BullMQ retries the `timeout-report` job (attempts: 3);
  on retry it re-reads `timeout_at` and reschedules / times out correctly. Idempotent.

## Deploy note
`STANDUP_TIMEOUT_MS` must now be set to the **same value on both the `api` and `worker`** services
(previously worker-only). If unset, both default to 4h — still consistent.

## Testing
- **`timeoutReport`** (worker unit, real PG + an injected `enqueueTimeout` spy):
  - `in_progress` + `timeout_at` in the future → re-enqueues (spy called once with ~the remaining
    delay), report stays `in_progress`, run not finalized.
  - `in_progress` + `timeout_at` in the past → `timed_out` + finalized, no re-enqueue.
  - `in_progress` + `timeout_at` null (legacy) → `timed_out`.
  - `completed` / `timed_out` → no-op, no re-enqueue.
- **`handleMessage` `next`** (api unit): after an answer that advances, the report's `timeout_at`
  is bumped to roughly `now + TIMEOUT` (assert it's in the future / greater than before).
- **`sendDm`** (worker unit): a newly-sent report has `timeout_at` set ~`now + TIMEOUT`.
- **`retrigger`** (worker unit): a reset report has a fresh `timeout_at`.
- Full `pnpm test` green; the new migration applies cleanly.

## Definition of done
1. New/updated unit tests + full `pnpm test` green; migration applies.
2. README/ContextDB: note the inactivity-timeout behavior and the `STANDUP_TIMEOUT_MS`-on-api
   deploy requirement. Build log.
3. No Slack config change. One schema column (`timeout_at`).

## Files (anticipated)
```
packages/db/src/schema.ts (+ migrations/000N_*.sql + meta)   # timeout_at
apps/worker/src/sendDm.ts · retrigger.ts                     # set timeout_at on create/reset
apps/api/src/handleMessage.ts (+ test)                       # bump timeout_at on each answer
apps/worker/src/timeoutReport.ts (+ test)                    # self-reschedule until deadline
apps/worker/src/processor.ts                                 # pass enqueueTimeout to timeoutReport
README.md · ContextDB/08_logs/2026-06-26-inactivity-timeout.md   # DoD
```
