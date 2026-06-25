# Late-Join Standup Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a member becomes a reporter mid-day (added, or flipped to `canReport=true`) and today's run is already open, enqueue a `send-dm` so they get today's standup instead of waiting for the next scheduled day.

**Architecture:** A new web-side `enqueueLateJoinIfOpen(memberId)` (guards: reporter + active standup + run-open-today + no existing report) enqueues the existing `send-dm` BullMQ job, which posts intro+Q1, inserts the report, and enqueues the 4h timeout. Called from the add-member and set-permissions server actions. `SendDmJob` moves to `@poddaily/shared` so the web can enqueue without importing `apps/worker`; `web` gains `bullmq` + `REDIS_URL`.

**Tech Stack:** Next.js 15 (Server Components + server actions), BullMQ, Drizzle (`@poddaily/db`), `@poddaily/shared`, Vitest.

Source: [late-join spec](../specs/2026-06-24-late-join-standup-design.md).

---

## File Structure

```
packages/shared/src/queue-contract.ts                # + SendDmJob + SEND_DM_JOB const
apps/worker/src/types.ts                             # re-export SendDmJob from shared
apps/worker/src/queue.ts                             # use SEND_DM_JOB const
apps/worker/src/processor.ts                         # dispatch on SEND_DM_JOB const
apps/web/package.json                                # + bullmq dependency
apps/web/lib/queue.ts                                # Queue singleton + enqueueSendDm
apps/web/lib/late-join.ts (+ late-join.test.ts)      # enqueueLateJoinIfOpen
apps/web/app/(dashboard)/teams/[id]/page.tsx         # call from add + set-perms actions
README.md · ContextDB/08_logs/2026-06-24-late-join.md   # DoD
```

---

### Task 1: Move `SendDmJob` + `SEND_DM_JOB` to `@poddaily/shared`

So the web can enqueue a `send-dm` job with the right shape and job name without importing `apps/worker`.

**Files:** Modify `packages/shared/src/queue-contract.ts`, `apps/worker/src/types.ts`, `apps/worker/src/queue.ts`, `apps/worker/src/processor.ts`.

- [ ] **Step 1: Add to `packages/shared/src/queue-contract.ts`** (append after `RetriggerJob`):

```ts
/** BullMQ job name for a per-member send-standup-dm job. */
export const SEND_DM_JOB = "send-dm";

/** Payload for a per-member send-standup-dm job. */
export interface SendDmJob {
  runId: string;
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
}
```

- [ ] **Step 2: Re-export from worker types** — in `apps/worker/src/types.ts`, remove the local `SendDmJob` interface and import+re-export it from shared (so `EnqueueSend` and all `./types` importers keep working). Change the top of the file:

```ts
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";
import type { SendDmJob } from "@poddaily/shared";

export type Db = ReturnType<typeof createDb>["db"];

export type { SendDmJob };
```
Delete the old `/** Payload for a per-member send-standup-dm job. */ export interface SendDmJob { ... }` block. Leave `EnqueueSend` (it references `SendDmJob`, now in scope via the import) and everything else unchanged.

- [ ] **Step 3: Use `SEND_DM_JOB` in the worker queue + processor** (single source of truth for the string):
  - `apps/worker/src/queue.ts`: add `SEND_DM_JOB` to the `@poddaily/shared` import (it already imports `QUEUE_NAME`), and in `makeEnqueueSend` change `queue.add("send-dm", job, {...})` → `queue.add(SEND_DM_JOB, job, {...})`.
  - `apps/worker/src/processor.ts`: import `SEND_DM_JOB` from `@poddaily/shared` and change `} else if (job.name === "send-dm") {` → `} else if (job.name === SEND_DM_JOB) {`.

- [ ] **Step 4: Verify (behavior-preserving — no new test)**

```
pnpm exec vitest run apps/worker/src/openRun.test.ts apps/worker/src/retrigger.test.ts
docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/worker/tests/standup-outbound-smoke.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: all pass / clean (the outbound smoke proves `send-dm` enqueue+dispatch still work end-to-end).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/queue-contract.ts apps/worker/src/types.ts apps/worker/src/queue.ts apps/worker/src/processor.ts
git commit -m "refactor(shared): move SendDmJob + SEND_DM_JOB to @poddaily/shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Web queue access (`bullmq` + `enqueueSendDm`)

**Files:** Modify `apps/web/package.json`; Create `apps/web/lib/queue.ts`.

- [ ] **Step 1: Add `bullmq` to web deps** — in `apps/web/package.json` `dependencies`, add `"bullmq": "^5.34.0"` (match the version used by `apps/api`/`apps/worker`). Run `pnpm install` from the repo root.

- [ ] **Step 2: Create `apps/web/lib/queue.ts`** — a lazily-constructed Queue singleton (survives Next dev HMR via `globalThis`, mirroring `apps/web/lib/db.ts`) + `enqueueSendDm`:

```ts
import { Queue } from "bullmq";
import { QUEUE_NAME, SEND_DM_JOB } from "@poddaily/shared";
import type { SendDmJob } from "@poddaily/shared";

const globalForQueue = globalThis as unknown as { _poddailyQueue?: Queue };

function getQueue(): Queue {
  const q = globalForQueue._poddailyQueue ?? new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
  if (process.env.NODE_ENV !== "production") globalForQueue._poddailyQueue = q;
  return q;
}

/** Enqueue a send-standup-dm job (immediate). Matches the worker's makeEnqueueSend opts. */
export async function enqueueSendDm(job: SendDmJob): Promise<void> {
  await getQueue().add(SEND_DM_JOB, job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
```

- [ ] **Step 3: Type-check the web app**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/lib/queue.ts
git commit -m "feat(web): bullmq queue access + enqueueSendDm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `enqueueLateJoinIfOpen`

**Files:** Create `apps/web/lib/late-join.ts`; Test `apps/web/lib/late-join.test.ts`.

- [ ] **Step 1: Write the failing test** — `apps/web/lib/late-join.test.ts` (real PG via `@/lib/db`, injected enqueue spy):

```ts
import { describe, it, expect, afterAll } from "vitest";
import { enqueueLateJoinIfOpen } from "./late-join";
import { sql } from "./db";

const CHAN = "C_LATEJOIN";

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id like 'U_LJ_%'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id like 'U_LJ_%'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

/** Seed team + standup (active by default) + optionally an open run today + a member. Returns memberId. */
async function seed(opts: { active?: boolean; runToday?: boolean; canReport?: boolean; withReport?: boolean; user?: string }): Promise<string> {
  await cleanup();
  const user = opts.user ?? "U_LJ_1";
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('LJ Pod', ${CHAN}, 'lj') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 9 * * 1,2,3,4,5', 'UTC', ${opts.active ?? true}) returning id`;
  let runId: string | null = null;
  if (opts.runToday) {
    const [r] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
    runId = r.id;
  }
  const [m] = await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report)
    values (${team.id}, ${user}, 'LJ Tester', 'UTC', ${opts.canReport ?? true}) returning id`;
  if (opts.withReport && runId) {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${user}, 'LJ Tester', ${JSON.stringify([])}, 'in_progress')`;
  }
  return m.id;
}

function spy() {
  const calls: any[] = [];
  const fn = async (job: any) => { calls.push(job); };
  return Object.assign(fn, { calls });
}

describe("enqueueLateJoinIfOpen", () => {
  it("enqueues a send-dm for a reporter with an open run and no report yet", async () => {
    const memberId = await seed({ runToday: true });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(1);
    expect(enqueue.calls[0].slackUserId).toBe("U_LJ_1");
    expect(enqueue.calls[0].runId).toBeTruthy();
    expect(enqueue.calls[0].standupId).toBeTruthy();
  });

  it("does nothing when no run is open today", async () => {
    const memberId = await seed({ runToday: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing for a non-reporting member", async () => {
    const memberId = await seed({ runToday: true, canReport: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing when the standup is paused", async () => {
    const memberId = await seed({ runToday: true, active: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing when the member already has a report for today's run", async () => {
    const memberId = await seed({ runToday: true, withReport: true });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/web/lib/late-join.test.ts`
Expected: FAIL — `enqueueLateJoinIfOpen` not exported. (Postgres is already configured — other web lib tests use it.)

- [ ] **Step 3: Implement `apps/web/lib/late-join.ts`**

```ts
import { eq, and, schema } from "@poddaily/db";
import { anchorDate } from "@poddaily/shared";
import type { SendDmJob } from "@poddaily/shared";
import { db } from "./db";
import { getStandup } from "./standups";
import { enqueueSendDm } from "./queue";

/**
 * If a member is a reporter and today's run for their team's active standup is already open
 * (and they have no report yet), enqueue a send-standup-dm so they get today's standup now.
 * `enqueue` is injectable for tests. Guards short-circuit on the first failure.
 */
export async function enqueueLateJoinIfOpen(
  memberId: string,
  enqueue: (job: SendDmJob) => Promise<void> = enqueueSendDm,
): Promise<void> {
  const [member] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, memberId));
  if (!member || !member.canReport || !member.teamId) return;

  const standup = await getStandup(member.teamId);
  if (!standup || standup.isActive === false) return; // missing or paused

  const todayDate = anchorDate(standup.scheduleTz, new Date());
  const [run] = await db
    .select({ id: schema.standupRuns.id })
    .from(schema.standupRuns)
    .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, todayDate)));
  if (!run) return; // no run open today — normal fan-out / next scheduled day handles it

  const [existing] = await db
    .select({ id: schema.standupReports.id })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, run.id), eq(schema.standupReports.slackUserId, member.slackUserId)));
  if (existing) return; // already got it / already reported

  await enqueue({ runId: run.id, standupId: standup.id, slackUserId: member.slackUserId, slackDisplayName: member.slackDisplayName });
}
```

- [ ] **Step 4: Run, verify it PASSES**

Run: `pnpm exec vitest run apps/web/lib/late-join.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Type-check the web app**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/late-join.ts apps/web/lib/late-join.test.ts
git commit -m "feat(web): enqueueLateJoinIfOpen — deliver today's standup to a mid-day reporter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire both call sites in the team detail page

**Files:** Modify `apps/web/app/(dashboard)/teams/[id]/page.tsx`.

No new test (thin wiring of the tested `enqueueLateJoinIfOpen`); verified by type-check.

- [ ] **Step 1: Import the helper** — add to the page's imports:

```ts
import { enqueueLateJoinIfOpen } from "@/lib/late-join";
```

- [ ] **Step 2: Call it from `addMemberAction`** — after the avatar `try/catch` and before `revalidatePath(\`/teams/${id}\`)`, add a best-effort late-join enqueue (`member` is already in scope from `addMember(...)`):

```ts
    try {
      await enqueueLateJoinIfOpen(member.id);
    } catch (err) {
      console.warn(`[late-join] enqueue failed for ${member.id}:`, (err as Error).message);
    }
```

- [ ] **Step 3: Call it from `setPermAction`** — capture the member id, and after `setMemberPermissions(...)` (before `revalidatePath`), add the same best-effort call. Replace the body of `setPermAction` with:

```ts
  async function setPermAction(fd: FormData) {
    "use server";
    const memberId = String(fd.get("memberId"));
    await setMemberPermissions(memberId, {
      canView: fd.get("canView") === "true",
      canReport: fd.get("canReport") === "true",
      canEdit: fd.get("canEdit") === "true",
    });
    try {
      await enqueueLateJoinIfOpen(memberId);
    } catch (err) {
      console.warn(`[late-join] enqueue failed for ${memberId}:`, (err as Error).message);
    }
    revalidatePath(`/teams/${id}`);
  }
```

- [ ] **Step 4: Type-check the web app**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/teams/[id]/page.tsx"
git commit -m "feat(web): deliver today's standup on mid-day member add / report grant

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Definition-of-done — docs + full verify

**Files:** Modify `README.md`; Create `ContextDB/08_logs/2026-06-24-late-join.md`.

- [ ] **Step 1: README** — in the team/members area (and near the existing `REDIS_URL` notes), add a short note: adding a member — or flipping their **Report** permission on — mid-day delivers **today's** standup if the run is already open (otherwise the normal schedule / next day applies). Note the **`web` service now needs `REDIS_URL`** (and `bullmq` is a web dependency) for this catch-up to fire; without it the member is still added but won't get the same-day DM.

- [ ] **Step 2: Build log** — create `ContextDB/08_logs/2026-06-24-late-join.md` (follow prior logs): What shipped (`SendDmJob`/`SEND_DM_JOB` → shared; web `enqueueSendDm`; `enqueueLateJoinIfOpen` + both call sites), Verification (`pnpm test` totals), Notable decisions (enqueue-on-change not a sweeper; gate on run-open-today; finalized runs still count; best-effort/idempotent; `web` gains Redis), and the deploy note (set `REDIS_URL` on `web`). Phase 2 remaining: B reminders, D RBAC.

- [ ] **Step 3: Full verification**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm test`
Expected: all green — paste the totals. If anything fails, STOP and report.

- [ ] **Step 4: Commit**

```bash
git add README.md ContextDB/08_logs/2026-06-24-late-join.md
git commit -m "docs: late-join standup delivery (README, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Enqueue `send-dm` (reuse, with timeout) → Tasks 2 + 3. ✓
- Trigger = run-open-today, finalized runs still count (no status filter on the run query) → Task 3 guard. ✓
- Both call sites (add + set-perms) → Task 4. ✓
- `SendDmJob` → shared so web doesn't import worker → Task 1. ✓
- `web` gains `bullmq` + `REDIS_URL` → Tasks 2 + 5 (docs). ✓
- Best-effort (try/catch, never blocks) → Task 4. ✓
- Idempotent (no-existing-report guard + send-dm backstop) → Task 3. ✓
- Unit test for all guard paths; no new smoke → Task 3. ✓
- DoD docs + deploy note → Task 5. ✓

**Placeholder scan:** every code step has complete code; no TBDs. ✓

**Type consistency:** `SendDmJob { runId, standupId, slackUserId, slackDisplayName }` defined in Task 1, used by `enqueueSendDm` (Task 2) and `enqueueLateJoinIfOpen` (Task 3). `SEND_DM_JOB` defined Task 1, used by worker (Task 1) + web queue (Task 2). `enqueueLateJoinIfOpen(memberId, enqueue?)` defined Task 3, called with one arg in Task 4. `standup.isActive` is `boolean | null` — Task 3 treats `=== false` as paused (matches the pause feature). ✓
