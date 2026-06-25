# Late-Join Standup Delivery (Phase 2)

- **Date:** 2026-06-24
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — follow-on feature (operational completeness)
- **Motivation:** A member added (or granted "report") after today's run has already opened gets
  no standup that day — `openRun` fans out only to the members who exist at run-open time. They
  should still receive today's standup instead of waiting until the next scheduled day.

## Summary

When a member **becomes a reporter mid-day** (added to a team, or flipped to `canReport=true`),
and **today's run is already open** for their team's active standup, enqueue a `send-dm` job for
them. The existing `send-dm` worker job does everything correctly — posts intro + Q1, inserts the
`in_progress` report, and enqueues the member's 4h timeout — and is idempotent on the report row.

## Why enqueue (not a direct web send)

The web already has `@poddaily/slack-client` + a bot token, so it *could* DM directly. But the
`send-dm` job also **enqueues the per-report 4h timeout**; a directly-sent member would have no
timeout job, so their report could hang `in_progress` forever and the run would never finalize.
Therefore late-join must enqueue a `send-dm` job, not send inline. This also reuses the fully
tested `send-dm` path verbatim.

## Why "run already open today" is the exact trigger

`openRun` queries `can_report` members and fans out `send-dm` **at the moment the run opens** (the
standup's scheduled time). So:
- Added **before** the send → the member exists when `openRun` fans out → included normally. No
  catch-up needed.
- Added **after** the run opened → not in the fan-out → gets nothing today. **This is the gap.**

So late-join only acts when a run already exists for today.

## Decisions locked

1. **Trigger: enqueue-on-change** (not a sweeper) — immediate, reuses `send-dm` incl. the timeout.
2. **Both call sites** — adding a member *and* flipping an existing member to `canReport=true`.
3. **Finalized run still counts** — if today's run already completed, the late member still gets
   it; when they finish, their report appends to today's channel thread and the counter bumps (the
   existing broadcast + idempotent `finalizeRunIfDone` already handle a late report on a finalized
   run).
4. **No wall-clock window** — gating on "a run is open today" naturally bounds delivery (runs open
   at the scheduled time and finalize/timeout within ~4h; they are not open at midnight).

## Architecture & components

### 1. Shared: move `SendDmJob` to `@poddaily/shared`
- Move the `SendDmJob` interface (`{ runId, standupId, slackUserId, slackDisplayName }`) from
  `apps/worker/src/types.ts` into `packages/shared/src/queue-contract.ts` (next to `QUEUE_NAME` /
  `RetriggerJob`), so the web can enqueue with the right shape **without importing `apps/worker`**
  (the web Docker image excludes the worker). `apps/worker/src/types.ts` re-exports it from shared
  (or imports it) so existing worker imports of `SendDmJob` are unchanged. The `"send-dm"` job name
  is also added as a shared const (`SEND_DM_JOB = "send-dm"`) to avoid string drift between the
  worker consumer and the new web producer.

### 2. Web: queue access
- `web` gains `bullmq` as a runtime **dependency** and needs `REDIS_URL` (mirrors what `api` got
  for re-trigger).
- New `apps/web/lib/queue.ts`: a lazily-constructed BullMQ `Queue(QUEUE_NAME)` singleton + an
  `enqueueSendDm(job: SendDmJob): Promise<void>` helper that does
  `queue.add(SEND_DM_JOB, job, { attempts: 3, backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: true, removeOnFail: false })` — matching the worker's `makeEnqueueSend` opts.

### 3. Web: the trigger function
- New `enqueueLateJoinIfOpen(memberId: string, enqueue = enqueueSendDm): Promise<void>` in a web
  lib (e.g. `apps/web/lib/late-join.ts`). Steps, short-circuiting on the first failed guard:
  1. Load the member (`team_members` by id). If missing or `!canReport` → return.
  2. Load the team's standup (`getStandup(member.teamId)`). If missing or `!isActive` → return.
  3. Compute `todayDate = anchorDate(standup.scheduleTz, new Date())`; load the run for
     `(standup.id, scheduled_date = todayDate)`. If none → return.
  4. If a `standup_reports` row already exists for `(run.id, member.slackUserId)` → return.
  5. Else `enqueue({ runId: run.id, standupId: standup.id, slackUserId: member.slackUserId,
     slackDisplayName: member.slackDisplayName })`.
- `enqueue` is injectable so the unit test passes a spy (no Redis needed).

### 4. Call sites
- The team detail page **add-member** server action (`apps/web/app/(dashboard)/teams/[id]/page.tsx`):
  after `addMember(...)` (+ avatar fetch), `await enqueueLateJoinIfOpen(member.id)`.
- The team detail page **set-permissions** server action: after `setMemberPermissions(...)`,
  `await enqueueLateJoinIfOpen(memberId)`. Calling it on *any* permission change is safe — the
  `canReport` + no-existing-report guards filter out view/edit toggles and already-reported members.

### Data flow
```
admin adds Mauro (or flips his Report on) at 10:00, run opened 09:00
  → server action: enqueueLateJoinIfOpen(memberId)
       canReport? standup active? run open today? no report row yet? → all yes
       → enqueueSendDm({ runId, standupId, slackUserId, slackDisplayName })
  → worker send-dm: posts intro + Q1, inserts in_progress report, enqueues 4h timeout
  → Mauro answers → completes → broadcast appends to today's thread, counter bumps
```

## Error handling
- **Best-effort:** both call sites wrap `enqueueLateJoinIfOpen` in try/catch and log; a failure
  (e.g. Redis down) never blocks the add / permission update. The member is still added; they just
  miss the same-day catch-up and get the standup on the next scheduled day.
- **Idempotent:** the step-4 report-row guard avoids enqueuing for members who already have a row;
  `send-dm`'s own existence check is the backstop, so a race at worst no-ops (no double-DM beyond
  the existing at-least-once posture).
- **No run / paused / non-reporter / non-scheduled day:** all handled by the guards returning early
  (no enqueue).

## Testing
- **Unit** (`apps/web/lib/late-join.test.ts`, real PG + an injected enqueue spy): seed a team +
  active standup + an open run for today, add a `can_report` member with no report → asserts one
  enqueue with the correct `runId`/`standupId`/`slackUserId`. Skip paths each assert **no** enqueue:
  no run today; `canReport=false`; paused standup (`is_active=false`); a member who already has a
  report row for today's run.
- **No new smoke required** — the `send-dm` worker path is already unit- and smoke-covered
  (`standup-outbound`, `smoke:standup`). (Optional, not gating: an end-to-end smoke that enqueues
  via `enqueueLateJoinIfOpen` against a real worker + stub and asserts the report row + DM.)
- Full `pnpm test` green.

## Definition of done
1. New unit test + full `pnpm test` green in CI.
2. README: a short note under the team/members section — adding a member (or granting Report)
   mid-day delivers today's standup if the run is open; the **`web` service now needs `REDIS_URL`**
   (+ `bullmq`). ContextDB: a build log; note the shared `SendDmJob` move.
3. No schema change, no Slack config change, no worker behavior change (only the `SendDmJob`
   type relocation).

## Files (anticipated)
```
packages/shared/src/queue-contract.ts                    # + SendDmJob + SEND_DM_JOB
apps/worker/src/types.ts                                 # re-export SendDmJob from shared
apps/web/package.json                                    # + bullmq dependency
apps/web/lib/queue.ts                                    # Queue singleton + enqueueSendDm
apps/web/lib/late-join.ts (+ late-join.test.ts)          # enqueueLateJoinIfOpen
apps/web/app/(dashboard)/teams/[id]/page.tsx             # call from add + set-perms actions
README.md · ContextDB/08_logs/2026-06-24-late-join.md    # DoD
```
