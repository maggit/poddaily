# 2026-06-23 — Standup re-trigger (DM keyword)

Phase 2 follow-on (operational resilience). A member whose standup timed out (or never ran
because the server was down) can now re-start **their own** standup for today by DMing the bot a
keyword. Spec: [2026-06-23-standup-retrigger-design.md](../../docs/superpowers/specs/2026-06-23-standup-retrigger-design.md).
Plan: [2026-06-23-standup-retrigger.md](../../docs/superpowers/plans/2026-06-23-standup-retrigger.md).

## What shipped

- **Shared queue contract** — `QUEUE_NAME` + a new `RetriggerJob` type moved to
  `@poddaily/shared` (`queue-contract.ts`), so the api can enqueue without importing
  `apps/worker` (the api Docker image excludes the worker). The worker re-exports `QUEUE_NAME`.
- **`ensureRunOpen` extracted from `openRun`** (`apps/worker/src/openRun.ts`) — opens-or-fetches
  today's run (posting the channel opening message on first open) and returns `{ run, created }`,
  without the per-member fan-out. `openRun` now composes it (fans out only when `created`).
  Behavior-preserving (existing openRun unit tests + the outbound smoke still green).
- **Worker `retrigger` handler** (`apps/worker/src/retrigger.ts`, dispatched by `processor.ts`)
  — `ensureRunOpen` → reset/create the member's report to a fresh `in_progress` (clearing
  `answers`, `reported_at`) → set the run back to `running` → re-send intro + Q1 to the DM →
  enqueue a fresh `timeout-report`. Self-contained posting; deliberately does **not** refactor
  `sendDm` (protect the live daily-send path).
- **api keyword detection** (`apps/api/src/handleMessage.ts`) — at the no-open-report path,
  `maybeRetrigger` matches `redo` / `restart` / `start` / `standup` (whole message,
  case-insensitive), resolves the member's standup, blocks with "already reported today ✅" if
  today's report is `completed`, else enqueues a `retrigger` job + acks "Restarting…". "Today" is
  the tz-anchored date (`anchorDate`) so it matches how the worker keys the run. `bullmq` moved
  from a devDep to a runtime **dependency** of the api; `index.ts` creates the `Queue` +
  `enqueueRetrigger` (the api needs `REDIS_URL`).
- **Hardening (post-review).** Two edge cases from the final code review:
  - *Retry-safe reset* — the retrigger handler now only (re)opens an **absent or `timed_out`**
    report; an `in_progress`/`completed` row is left untouched, so a delayed BullMQ retry can't
    wipe answers the member already typed.
  - *Team recovery* — when retrigger has to **open** today's run itself (`ensureRunOpen` returns
    `created: true` — the scheduler was down, or the keyword arrived before the scheduled tick),
    it fans out the standard send to the **rest of the team** (requester excluded; they get the
    direct re-DM) via a `fanOutSends` extracted from `openRun`. This refines the original
    "self-scoped" decision: re-trigger stays self-scoped when the run already exists (the common
    timed-out case), but recovers the whole team when the run never opened — closing a gap where
    a keyword before the schedule would otherwise suppress the day's fan-out for everyone else.
    `openRun`'s scheduled behavior is unchanged (proven by its unit tests + the outbound smoke).

## Verification

- `pnpm test` — **137 passed / 137** (33 files), 0 failures.
- New: `apps/worker/src/openRun.test.ts` (ensureRunOpen case), `apps/worker/src/retrigger.test.ts`
  (reset timed_out → in_progress + run running + Q1 + timeout; absent member; run-not-open),
  `apps/api/src/handleMessage.test.ts` (keyword→enqueue; completed→block, no enqueue;
  non-keyword→ignore), and `apps/api/tests/retrigger-smoke.test.ts` — full end-to-end against real
  Redis + slack-stub: timed-out report → DM "redo" → api enqueues → worker re-opens & re-DMs →
  member answers → `completed` + broadcast (`channel_post_ts` set). New script: `smoke:retrigger`.

## Notable decisions

- **In-DM keyword** (not a `/standup` slash command) → reuses the existing `message.im`
  subscription, **no Slack app config change**.
- **Self-scoped, incomplete-only, ensure-run-DM-only-me** — DMs only the requester; never
  re-broadcasts an already-completed report; opens the run if it never ran but fans out to no one
  else.
- **Worker job (Approach A)** — the api stays thin (detect + enqueue + ack); the worker owns
  run-lifecycle + DM + timeout.
- **Retrigger handler is self-contained** (not a `sendDm` refactor) — deliberate, to avoid
  regression risk on the critical daily-send path; the duplication is ~15 lines and the report
  write differs (reset vs insert).
- **No double-broadcast** — a `timed_out` report was never broadcast; after reset → complete it
  broadcasts once via the existing complete path; the run is set back to `running` so
  `finalizeRunIfDone` re-completes it.

## Definition of done

1. Automated unit + smoke green in CI ✅ (134/134; `smoke:retrigger` added).
2. **Live walk — PENDING**: time a daily out (short `STANDUP_TIMEOUT_MS`), DM the bot `redo`,
   confirm it re-asks Q1, answer it, confirm the report completes + posts to the channel. Also
   redeploy the **`api`** service so it has `REDIS_URL` + the new `bullmq` dep.
3. README + this context updated ✅.
4. No Slack app config change ✅.

## Known limitations / follow-ons

- The api's "already completed today" pre-check uses `anchorDate(scheduleTz)`; near midnight in a
  non-UTC tz it could disagree with a run keyed on a different anchor — a benign edge (worst case
  a re-DM), the worker's `ensureRunOpen` remains authoritative.
- Phase 2 backlog still open: reminders (B), admin controls / pause-resume + Slack-connected badge
  (C), RBAC tiers (D) — see [phase-2-backlog.md](../todos/phase-2-backlog.md).
