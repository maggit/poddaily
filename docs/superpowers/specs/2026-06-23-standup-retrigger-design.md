# Standup Re-trigger Design (Phase 2)

- **Date:** 2026-06-23
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — follow-on feature (operational resilience)
- **Motivation:** a member whose daily timed out (e.g. the server was down) has no way to redo it.

## Summary

Let a member **re-start their own standup for today** by sending a keyword in the bot DM
(`redo` / `restart` / `start` / `standup`). The api recognizes the keyword (at the spot where it
currently ignores an unanswered DM) and enqueues a `retrigger` job; the **worker** ensures
today's run is open, resets the member's report to a fresh `in_progress`, re-sends Q1, and
schedules a new 4h timeout — reusing its existing `openRun`/`sendDm`/timeout machinery.

## Scope

**In scope (v1):**
- In-DM **keyword** re-trigger, scoped to the **requesting member** (1:1 DM → their own standup).
- **Incomplete-only:** works when today's report is `timed_out` / missing / the run never opened.
  If already `completed` today → reply "You've already reported today ✅" and do nothing.
- **Ensure-run-but-DM-only-me:** if today's run never opened (server was down), opening it (for
  channel threading) but DMing **only the requester** — not fanning out to the whole team.
- **Architecture A — worker job:** api detects + enqueues; worker does the work.

**Out of scope (later / not now):**
- `/standup` slash command + button/interactivity (would need Slack app config) — keyword only.
- Whole-team re-run from one member's DM (that's a future admin "re-run" action on the dashboard).
- Redoing an already-**completed** standup (would need to edit/replace the existing channel post).
- Re-trigger mid-conversation: if the member has an open `in_progress` report, their message is an
  answer (existing behavior) — re-trigger only fires on the no-open-report path.

## Decisions locked

1. **Keyword set:** `redo`, `restart`, `start`, `standup` (case-insensitive, trimmed, exact match
   of the whole message — so a normal answer like "I will redo the migration" never triggers).
2. **Self-scoped, incomplete-only, ensure-run-DM-only-me** (above).
3. **Worker job** (Approach A): the worker owns run-lifecycle + DM + timeout; the api stays thin.
4. **No double-broadcast:** a `timed_out` report was never broadcast; after reset → complete it
   broadcasts once (the existing complete path). On reset, set the run back to `running` so
   `finalizeRunIfDone` re-completes it when the member finishes.

## Architecture & components

### 1. Shared queue contract (`packages/shared` or a small shared module)

The api must enqueue to the worker's BullMQ queue, but it can't import `apps/worker` (the api's
Docker image doesn't contain it). So move the shared bits to a package both import:
- `QUEUE_NAME` (currently in `apps/worker/src/queue.ts`) → exported from `@poddaily/shared`.
- A `RetriggerJob` type: `{ standupId: string; slackUserId: string; slackDisplayName: string; channel: string }`.

`apps/worker/src/queue.ts` imports `QUEUE_NAME` from shared instead of defining it locally
(no behavior change). The api creates its own `Queue(QUEUE_NAME, { connection })` to enqueue.

### 2. api — keyword detection + enqueue (`apps/api/src/handleMessage.ts`)

At the current no-in-progress-report early return (`handleMessage.ts:47`), instead of always
returning:
- If the trimmed-lowercased message is one of the keywords:
  - Resolve the member's standup: `team_members` (by `slackUserId`) → `teamId` → the team's
    `standups` row. If the member belongs to no team/standup → reply "You're not set up for a
    standup yet." and return.
  - Look up today's run for that standup (`scheduled_date = current_date`) and the member's report:
    - report `completed` today → reply "You've already reported today ✅", return.
    - otherwise → `enqueueRetrigger({ standupId, slackUserId, slackDisplayName, channel: msg.channel })`
      and reply "📋 Restarting your standup…", return.
- If not a keyword → return (ignore, as today).

The api gains a BullMQ `Queue` (it already has `REDIS_URL`); `bullmq` moves from a devDep to a
dependency of `@poddaily/api`. A small `enqueueRetrigger(queue, job)` helper (next to the api's
queue setup, or shared) does `queue.add("retrigger", job, { attempts: 3, backoff })`.

The api needs the member's display name for the job — fetch it from `team_members` during the
standup lookup.

### 3. worker — `retrigger` job handler (`apps/worker/src/retrigger.ts`)

Dispatched by the processor on `job.name === "retrigger"`. Steps:
1. **Ensure today's run is open.** Refactor `openRun` to extract `ensureRunOpen(deps, standupId,
   now) → run` — the run insert + opening-message logic (`openRun.ts:27-64`) **returning the
   existing-or-new run** (on a second call for the same day it `select`s the existing run rather
   than returning null), **without** the per-member fan-out. `openRun` keeps its own guards
   (`isActive` / `teamId` / `isActiveWeekday`, lines 18-25) and the fan-out loop, calling
   `ensureRunOpen` in the middle — no behavior change for the scheduled path. The retrigger
   handler does its OWN minimal guard (standup exists + `isActive` + `teamId`) and then calls
   `ensureRunOpen` — deliberately **skipping the weekday check** (a member explicitly asking to
   report today should work even on an off-day).
2. **Reset the member's report** for that run to a fresh `in_progress` (clear `answers`); upsert
   on `(run_id, slack_user_id)` so a `timed_out` row is reset and an absent member gets a new row.
   Set the **run `status` back to `running`** (it may have been `completed` by the sweeper).
3. **Re-send the DM.** Reuse `sendDm`'s posting (interpolate Q1 via `{last_report_date}`, post
   intro + Q1 to the member's DM) — factor the "post the standup DM to a member" core out of
   `sendDm` so both the normal send and the retrigger use it. Then **enqueue a fresh
   `timeout-report`** for the reset report (the existing `makeEnqueueTimeout`).

The worker already has `slack`, `db`, the queue (for the timeout), and the openRun/sendDm logic —
so the retrigger handler is mostly composition of existing pieces.

### Data flow

```
member DMs "redo" (no open report)
  → api: keyword? resolve standup + today's report
       ├─ completed today → "You've already reported today ✅"   (stop)
       └─ else → enqueue retrigger job + "📋 Restarting your standup…"
  → worker retrigger handler:
       ensureRunOpen(standupId)            # open run + opening message if missing
       reset member's report → in_progress, run → running
       post intro + Q1 to the member       # reuse sendDm core
       enqueue fresh 4h timeout-report
  → member answers → (existing) complete → broadcast → finalizeRunIfDone re-completes the run
```

## Error handling

- **Member has no standup** → friendly api reply; no job enqueued.
- **Already completed** → friendly api reply; no reset (avoids touching an already-broadcast report).
- **Best-effort, idempotent:** the retrigger handler retries (BullMQ 3×); re-running it just
  re-resets the report to `in_progress` + re-sends (the member gets Q1 again — acceptable). The
  opening-message post is best-effort (as in `openRun`).
- **Keyword false-positive:** whole-message exact match on a small keyword set; a real answer is
  never a bare keyword. (And re-trigger only fires when there's no open conversation.)

## Testing

- **api unit** (`handleMessage.test.ts`): a keyword with no open report + an incomplete today →
  enqueues a retrigger job (assert via an injected enqueue spy) + the ack reply; a keyword when
  today is already `completed` → the "already reported" reply, no enqueue; a non-keyword stray DM
  → still ignored (no enqueue). (The api's enqueue is dependency-injected for testability.)
- **worker unit** (`retrigger.test.ts`, real PG + a fake slack/enqueue): a `timed_out` report →
  reset to `in_progress`, run `running`, Q1 posted, timeout enqueued; an absent member → report
  created; run-not-open → run opened (opening message) + report created.
- **`ensureRunOpen`** covered by the existing `openRun` tests (refactor is behavior-preserving) +
  a direct case (returns the existing run's id on a second call).
- **smoke** (extend `edges` or a new `retrigger` smoke): member times out → DMs "redo" → worker
  re-DMs Q1 → member answers → completes → broadcast; assert the re-opened report ends `completed`
  and the run `completed`.

## Definition of done

1. New unit + smoke tests green in CI; full suite green.
2. Live walk: let a daily time out (short `STANDUP_TIMEOUT_MS`), DM the bot `redo`, confirm it
   re-asks Q1, answer it, confirm the report completes + posts to the channel.
3. README: note the re-trigger keywords in the bot/usage section. ContextDB: slack-integration
   (DM engine) note + build log. `bullmq` listed as an api dependency; `INTERNAL`/`REDIS_URL`
   already on the api.
4. No Slack app config change (keyword reuses `message.im`).

## Files (anticipated)

```
packages/shared/src/queue-contract.ts (+ index re-export)   # QUEUE_NAME + RetriggerJob type
apps/worker/src/queue.ts                                     # import QUEUE_NAME from shared
apps/api/package.json                                        # bullmq → dependency
apps/api/src/queue.ts (or inline)                            # api Queue + enqueueRetrigger
apps/api/src/handleMessage.ts (+ test)                       # keyword detection + enqueue + acks
apps/worker/src/openRun.ts                                   # extract ensureRunOpen
apps/worker/src/sendDm.ts                                    # extract postStandupDm core (reused)
apps/worker/src/retrigger.ts (+ test)                        # the retrigger handler
apps/worker/src/processor.ts                                 # dispatch "retrigger"
apps/api/tests/ or apps/worker/tests/ retrigger smoke        # end-to-end
README.md · ContextDB/* · build log                          # DoD
```

## Notes / reuse

- Reuses `ensureRunOpen` (from `openRun`), the `sendDm` posting core, `makeEnqueueTimeout`,
  `interpolateLastReportDate`, `finalizeRunIfDone` — re-trigger is mostly re-composition.
- No new schema. No Slack app config. `bullmq` becomes an api dependency (it has `REDIS_URL`).
