# Step 7 — Timeout Sweep + Run Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member's report left `in_progress` 4 hours after their DM started is marked `timed_out` (never broadcast), and a `standup_run` is marked `completed` once all its reports are terminal — closing out the standup lifecycle and completing Phase 1 Core.

**Architecture:** When `sendDm` inserts the `in_progress` report it also enqueues a per-report `timeout-report` BullMQ job delayed `STANDUP_TIMEOUT_MS` (default 4h). On fire, the handler marks the report `timed_out` if still `in_progress`, then calls a shared `finalizeRunIfDone(db, runId)` that marks the run `completed` once every report is terminal. The same finalize runs from `handleMessage`'s complete branch. Event-driven — no periodic sweeper, no separate `complete-run` timer. No new schema.

**Tech Stack:** BullMQ delayed jobs (`@poddaily/worker`), Drizzle (`@poddaily/db`), `@slack/bolt` api, Vitest, real Redis + Postgres + the `tools/slack-stub`.

Source: [Step 7 design spec](../specs/2026-06-20-step7-timeout-run-completion-design.md) · [scheduler §Completion & timeout](../../../ContextDB/02_architecture/scheduler.md#completion--timeout) · [slack-integration §Failure & edge handling](../../../ContextDB/02_architecture/slack-integration.md#failure--edge-handling).

> **Scope notes:**
> 1. **No new schema** — `standup_runs.status`/`completed_at` and `standup_reports.status` (which already takes `timed_out`, set by 5b's `skip all`) are reused.
> 2. **Retry (3× backoff) and skip/skip-all are already shipped** (5a/5b) — not touched here.
> 3. **`STANDUP_TIMEOUT_MS` is read at call time** (not module-load) so tests/smoke can set a tiny value before triggering. Default 4h.
> 4. **Partials never broadcast — by construction:** a `timed_out` report never reaches `handleMessage`'s complete branch, so `broadcastReport` never runs for it. The opening-message counter (`reported` = completed count) already excludes `timed_out`.
> 5. **Zero-report run** completes immediately (vacuously all-terminal) — accepted.

---

## File Structure

```
packages/db/src/runs.ts (+ test)            # finalizeRunIfDone
packages/db/src/index.ts                    # re-export finalizeRunIfDone
apps/worker/src/types.ts                    # + TimeoutJob, EnqueueTimeout; SendDmDeps gains enqueueTimeout
apps/worker/src/timeoutReport.ts (+ test)   # the timeout-report handler
apps/worker/src/queue.ts                    # + makeEnqueueTimeout
apps/worker/src/sendDm.ts (+ test)          # enqueue timeout-report after the report insert
apps/worker/src/processor.ts                # dispatch timeout-report; provide enqueueTimeout to sendDm
apps/api/src/handleMessage.ts (+ test)      # finalizeRunIfDone after broadcast on complete
apps/api/tests/edges-smoke.test.ts          # smoke:edges (timeout + completion, end-to-end)
package.json                                # + smoke:edges script
README.md · ContextDB/* · build log         # DoD + Phase 1 complete
```

---

### Task 1: `finalizeRunIfDone` in `@poddaily/db` (integration TDD)

**Files:**
- Create: `packages/db/src/runs.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/runs.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/db/src/runs.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "./client";
import { finalizeRunIfDone } from "./runs";

const { db, sql } = createDb();
const CHAN = "C_RUNS_TEST";

async function seedRun(reportStatuses: string[]): Promise<string> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Runs Pod', ${CHAN}, 'runs') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  for (let i = 0; i < reportStatuses.length; i++) {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${"U_RUNS_" + i}, 'R', ${JSON.stringify([])}, ${reportStatuses[i]})`;
  }
  return run.id;
}
async function cleanup() {
  await sql`delete from standup_reports where run_id in (select id from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})))`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("finalizeRunIfDone", () => {
  it("completes a run when all reports are terminal", async () => {
    const runId = await seedRun(["completed", "timed_out"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    const [run] = await sql`select status, completed_at from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(run.completed_at).not.toBeNull();
  });
  it("does nothing when a report is still in_progress", async () => {
    const runId = await seedRun(["completed", "in_progress"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(false);
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("running");
  });
  it("is idempotent — returns false on an already-completed run", async () => {
    const runId = await seedRun(["completed"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    expect(await finalizeRunIfDone(db, runId)).toBe(false);
  });
  it("completes a zero-report run (vacuously terminal)", async () => {
    const runId = await seedRun([]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run from repo root, confirm FAIL** (module not found). Requires Postgres.

Run: `pnpm exec vitest run packages/db/src/runs.test.ts`

- [ ] **Step 3: Implement** — `packages/db/src/runs.ts`

```ts
import { eq, and, ne } from "drizzle-orm";
import * as schema from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

const TERMINAL = new Set(["completed", "timed_out"]);

/**
 * Mark a run `completed` once every report for it is terminal (completed | timed_out).
 * Returns whether this call performed the completion. Idempotent + concurrency-safe:
 * the early return plus the `status != 'completed'` guard mean overlapping callers
 * (the timeout handler and the api completing the last report) converge to one completion.
 */
export async function finalizeRunIfDone(db: Db, runId: string): Promise<boolean> {
  const [run] = await db
    .select({ status: schema.standupRuns.status })
    .from(schema.standupRuns)
    .where(eq(schema.standupRuns.id, runId));
  if (!run || run.status === "completed") return false;

  const reports = await db
    .select({ status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(eq(schema.standupReports.runId, runId));
  if (!reports.every((r) => r.status !== null && TERMINAL.has(r.status))) return false;

  const updated = await db
    .update(schema.standupRuns)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(schema.standupRuns.id, runId), ne(schema.standupRuns.status, "completed")))
    .returning({ id: schema.standupRuns.id });
  return updated.length > 0;
}
```

- [ ] **Step 4: Re-export** — add to `packages/db/src/index.ts`:

```ts
export { finalizeRunIfDone } from "./runs";
```

- [ ] **Step 5: Run from repo root, confirm PASS** (4 tests).

Run: `pnpm exec vitest run packages/db/src/runs.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/runs.ts packages/db/src/runs.test.ts packages/db/src/index.ts
git commit -m "feat(db): finalizeRunIfDone — complete a run when all reports terminal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `timeout-report` handler in the worker (integration TDD)

**Files:**
- Modify: `apps/worker/src/types.ts`
- Create: `apps/worker/src/timeoutReport.ts`
- Test: `apps/worker/src/timeoutReport.test.ts`

- [ ] **Step 1: Add the `TimeoutJob` type** — in `apps/worker/src/types.ts`, add:

```ts
/** Payload for a per-report timeout-report job (fires `delayMs` after the DM started). */
export interface TimeoutJob {
  runId: string;
  slackUserId: string;
}

/** Enqueue a timeout-report job, delayed `delayMs` from now. */
export type EnqueueTimeout = (job: TimeoutJob, opts: { delayMs: number }) => Promise<void>;
```
(Leave `SendDmDeps` alone for now — Task 3 adds `enqueueTimeout` to it.)

- [ ] **Step 2: Write the failing test** — `apps/worker/src/timeoutReport.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { timeoutReport } from "./timeoutReport";

const { db, sql } = createDb();
const CHAN = "C_TIMEOUT_TEST";
const USER = "U_TIMEOUT";

async function seed(reportStatus: string): Promise<{ runId: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('TO Pod', ${CHAN}, 'to') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'R', ${JSON.stringify([])}, ${reportStatus})`;
  return { runId: run.id };
}
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("timeoutReport", () => {
  it("times out an in_progress report and finalizes the run", async () => {
    const { runId } = await seed("in_progress");
    await timeoutReport({ db }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed"); // only report is now terminal
  });
  it("is a no-op when the report already completed", async () => {
    const { runId } = await seed("completed");
    await timeoutReport({ db }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("completed"); // unchanged
  });
});
```

- [ ] **Step 3: Run from repo root, confirm FAIL** (module not found).

Run: `pnpm exec vitest run apps/worker/src/timeoutReport.test.ts`

- [ ] **Step 4: Implement** — `apps/worker/src/timeoutReport.ts`

```ts
import { schema, eq, and, finalizeRunIfDone } from "@poddaily/db";
import type { Db, TimeoutJob } from "./types";

export interface TimeoutReportDeps {
  db: Db;
}

/**
 * Time out a member's report if it's still in_progress when this job fires (the job's
 * delay encodes the 4h, so firing == 4h elapsed — no clock recheck needed). No-op if the
 * member already finished (completed) or aborted (timed_out via `skip all`). Then finalize
 * the run, which closes it once every report is terminal.
 */
export async function timeoutReport(deps: TimeoutReportDeps, job: TimeoutJob): Promise<void> {
  const { db } = deps;
  const [report] = await db
    .select({ id: schema.standupReports.id, status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.runId, job.runId),
      eq(schema.standupReports.slackUserId, job.slackUserId),
    ));
  if (!report || report.status !== "in_progress") return;

  await db
    .update(schema.standupReports)
    .set({ status: "timed_out" })
    .where(eq(schema.standupReports.id, report.id));

  await finalizeRunIfDone(db, job.runId);
}
```
(`schema`, `eq`, `and`, `finalizeRunIfDone` all come from `@poddaily/db`.)

- [ ] **Step 5: Run from repo root, confirm PASS** (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/types.ts apps/worker/src/timeoutReport.ts apps/worker/src/timeoutReport.test.ts
git commit -m "feat(worker): timeout-report handler marks in_progress reports timed_out

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `sendDm` enqueues the timeout + processor wiring

**Files:**
- Modify: `apps/worker/src/types.ts` (SendDmDeps)
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/sendDm.ts`
- Modify: `apps/worker/src/processor.ts`
- Test: `apps/worker/src/sendDm.test.ts`

- [ ] **Step 1: Add `enqueueTimeout` to `SendDmDeps`** — in `apps/worker/src/types.ts`:

```ts
export interface SendDmDeps {
  db: Db;
  slack: SlackClient;
  enqueueTimeout: EnqueueTimeout;
}
```

- [ ] **Step 2: Add `makeEnqueueTimeout`** — in `apps/worker/src/queue.ts`. Update the import to include the new types and add the factory (mirror `makeEnqueueSend`):

```ts
import type { SendDmJob, EnqueueSend, TimeoutJob, EnqueueTimeout } from "./types";
```
```ts
/** An EnqueueTimeout backed by a real BullMQ queue (the timeout-report job). */
export function makeEnqueueTimeout(queue: Queue): EnqueueTimeout {
  return async (job: TimeoutJob, opts: { delayMs: number }) => {
    await queue.add("timeout-report", job, {
      delay: opts.delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  };
}
```

- [ ] **Step 3: Write the failing test** — add to `apps/worker/src/sendDm.test.ts`. The existing tests construct `sendDm({ db, slack }, …)` and use a real stub. They now need `enqueueTimeout`. Add a recorder and pass it to ALL `sendDm` calls; add a case asserting the timeout job is enqueued:

```ts
function makeEnqueueTimeoutRecorder() {
  const calls: Array<{ job: { runId: string; slackUserId: string }; delayMs: number }> = [];
  const fn = async (job: { runId: string; slackUserId: string }, opts: { delayMs: number }) => { calls.push({ job, delayMs: opts.delayMs }); };
  return Object.assign(fn, { calls });
}

it("enqueues a timeout-report for the member after sending", async () => {
  const enqueueTimeout = makeEnqueueTimeoutRecorder();
  const slack = createSlackClient();
  await sendDm({ db, slack, enqueueTimeout }, { runId, standupId, slackUserId: USER, slackDisplayName: "Tester" });
  expect(enqueueTimeout.calls).toHaveLength(1);
  expect(enqueueTimeout.calls[0].job).toEqual({ runId, slackUserId: USER });
  expect(enqueueTimeout.calls[0].delayMs).toBeGreaterThan(0);
});

it("respects STANDUP_TIMEOUT_MS for the timeout delay", async () => {
  process.env.STANDUP_TIMEOUT_MS = "1234";
  const enqueueTimeout = makeEnqueueTimeoutRecorder();
  const slack = createSlackClient();
  await sendDm({ db, slack, enqueueTimeout }, { runId, standupId, slackUserId: USER, slackDisplayName: "Tester" });
  expect(enqueueTimeout.calls[0]?.delayMs).toBe(1234);
  delete process.env.STANDUP_TIMEOUT_MS;
});
```
IMPORTANT: update the file's EXISTING `sendDm(...)` calls to include `enqueueTimeout: makeEnqueueTimeoutRecorder()` (or a shared no-op) so they compile. Use the file's real seeded `runId`/`standupId`/`USER` and the `seedRun` helper (fresh run so sendDm doesn't short-circuit on an existing report). Confirm the retry/no-op test (where a report already exists) does NOT enqueue a timeout (sendDm returns before the insert) — assert `calls` is empty there if convenient.

- [ ] **Step 4: Run from repo root, confirm the new cases FAIL.**

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`

- [ ] **Step 5: Implement** — in `apps/worker/src/sendDm.ts`:

Destructure `enqueueTimeout`:
```ts
  const { db, slack, enqueueTimeout } = deps;
```
Add a module-level constant near the top of the file (after imports):
```ts
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
```
At the very END of `sendDm`, AFTER the `db.insert(...).onConflictDoNothing(...)`, add:
```ts
  // Per-report 4h timeout (Step 7). Read at call time so tests can override. The delay
  // encodes the deadline; the timeout-report handler no-ops if the member finished first.
  const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);
  await enqueueTimeout({ runId, slackUserId }, { delayMs: timeoutMs });
```
(This runs only on the actual send path — the early `existing.length > 0` return happens before the insert, so a redelivered send doesn't enqueue a duplicate timeout.)

- [ ] **Step 6: Wire the processor** — in `apps/worker/src/processor.ts`:

```ts
import { makeEnqueueSend, makeEnqueueTimeout } from "./queue";
import { openRun } from "./openRun";
import { sendDm } from "./sendDm";
import { timeoutReport } from "./timeoutReport";
import type { Db, SendDmJob, TimeoutJob } from "./types";
```
Inside `createProcessor`, after `const enqueueSend = makeEnqueueSend(queue);` add:
```ts
  const enqueueTimeout = makeEnqueueTimeout(queue);
```
Update the dispatch:
```ts
    if (job.name === "open-run") {
      const { standupId } = job.data as { standupId: string };
      await openRun({ db, enqueueSend, slack }, standupId, new Date());
    } else if (job.name === "send-dm") {
      await sendDm({ db, slack, enqueueTimeout }, job.data as SendDmJob);
    } else if (job.name === "timeout-report") {
      await timeoutReport({ db }, job.data as TimeoutJob);
    } else {
      throw new Error(`[worker] unknown job name: ${job.name}`);
    }
```

- [ ] **Step 7: Run from repo root, confirm PASS** (existing + new). Then type-check the worker.

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`
Run: `pnpm --filter @poddaily/worker exec tsc --noEmit`
Expected: tests pass; type-check clean.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/types.ts apps/worker/src/queue.ts apps/worker/src/sendDm.ts apps/worker/src/processor.ts apps/worker/src/sendDm.test.ts
git commit -m "feat(worker): enqueue per-report timeout-report; dispatch it in the processor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `handleMessage` finalizes the run on completion

**Files:**
- Modify: `apps/api/src/handleMessage.ts`
- Test: `apps/api/src/handleMessage.test.ts`

- [ ] **Step 1: Write the failing test** — add to `apps/api/src/handleMessage.test.ts`. The existing tests seed a single-member run with `channel_opening_ts`; after the member completes, the run should be `completed`. Add:

```ts
it("finalizes the run when the last report completes", async () => {
  await sql`update standup_runs set channel_opening_ts = 'open_ts_fin' where id = ${runId}`;
  await sql`update standup_runs set status = 'running' where id = ${runId}`;
  const slack = fakeSlack();
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a1" });
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a2" });
  const [run] = await sql`select status, completed_at from standup_runs where id = ${runId}`;
  expect(run.status).toBe("completed");
  expect(run.completed_at).not.toBeNull();
});
```
(Use the file's real `USER`/`DM`/`runId`/`SECRET`/`makeUserSlack`/`fakeSlack`. The seeded standup has 2 questions, so the 2nd answer completes the single member's report → run finalizes. If the test's `beforeEach` re-seeds the report/run each time, ensure the run starts `running` — the snippet sets it explicitly.)

- [ ] **Step 2: Run from repo root, confirm it FAILS** (run not finalized yet — still `running`/`pending`).

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`

- [ ] **Step 3: Implement** — in `apps/api/src/handleMessage.ts`:

Add `finalizeRunIfDone` to the `@poddaily/db` import:
```ts
import { schema, eq, and, desc, getUserToken, finalizeRunIfDone } from "@poddaily/db";
```
In the `complete` case, AFTER the `broadcastReport(...)` call, add a best-effort finalize:
```ts
    case "complete":
      await db.update(schema.standupReports)
        .set({ answers: action.answers, status: "completed", reportedAt: new Date() })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, standup.outroMessage ?? DEFAULT_OUTRO);
      await broadcastReport(deps, { report, run, standup, answers: action.answers });
      try {
        await finalizeRunIfDone(db, run.id);
      } catch (err) {
        console.warn(`[finalize] degraded for run ${run.id}:`, (err as Error).message);
      }
      return;
```

- [ ] **Step 4: Run from repo root, confirm PASS** (existing + new). Type-check.

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`
Run: `pnpm --filter @poddaily/api exec tsc --noEmit`
Expected: pass; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handleMessage.ts apps/api/src/handleMessage.test.ts
git commit -m "feat(api): finalize the run when the last report completes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `smoke:edges` — timeout + completion end-to-end

**Files:**
- Create: `apps/api/tests/edges-smoke.test.ts`
- Modify: `package.json` (root) — add `smoke:edges`

- [ ] **Step 1: Write the smoke** — `apps/api/tests/edges-smoke.test.ts`. Base it on `apps/api/tests/standup-smoke.test.ts` (same harness: real BullMQ worker via `createProcessor`, real Redis, the stub, and direct `handleMessage` for inbound). Set a tiny `STANDUP_TIMEOUT_MS` so the per-report timeout fires quickly. Two members: A completes (broadcasts), B times out.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { enqueueOpenRun } from "../../worker/src/queue";
import { createProcessor } from "../../worker/src/processor";
import { handleMessage } from "../src/handleMessage";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "edges-smoke";
const { db, sql } = createDb();
const CHAN = "C_SMOKE_EDGES";
const USER_A = "U_EDGES_A";
const USER_B = "U_EDGES_B";
const DM = "D_EDGES";
const SECRET = "test-internal-api-secret-0123456789";
const makeUserSlack = (token: string) => createSlackClient({ token });
const CRON = cronFromWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 0, minute: 0 });

let stub: SlackStub;
let queue: Queue;
let worker: Worker;

beforeAll(async () => {
  process.env.STANDUP_TIMEOUT_MS = "1500"; // short timeout so B times out during the test
  stub = await startSlackStub(0);
  process.env.SLACK_API_BASE_URL = stub.url;
  process.env.SLACK_BOT_TOKEN = "xoxb-smoke";
  queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  await queue.obliterate({ force: true });
  const slack = createSlackClient();
  worker = new Worker(QUEUE_NAME, createProcessor({ db, slack, queue }), { connection: { url: REDIS_URL } });
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await stub.close();
  await cleanup();
  await sql.end();
  delete process.env.STANDUP_TIMEOUT_MS;
});
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id in (${USER_A}, ${USER_B})`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id in (${USER_A}, ${USER_B})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 12000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("smoke:edges", () => {
  it("times out an unanswered member and completes the run; the answerer is broadcast", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Edges Pod', ${CHAN}, 'edges') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER_A}, 'Edge A', 'UTC', true)`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER_B}, 'Edge B', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])},
              ${CRON}, 'UTC', 'Morning!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await enqueueOpenRun(queue, s.id);

    // both members get their in_progress report from the worker fan-out
    await waitFor(
      async () => (await sql`select count(*)::int as n from standup_reports where slack_user_id in (${USER_A}, ${USER_B}) and status = 'in_progress'`),
      (rows) => rows[0].n === 2,
    );

    // A answers both questions → completes + broadcasts
    const slack = createSlackClient();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER_A, channel: DM, text: "did A" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER_A, channel: DM, text: "will A" });

    // B never answers → its timeout-report (delay 1500ms) fires → timed_out → run completes
    await waitFor(
      async () => (await sql`select status from standup_reports where slack_user_id = ${USER_B}`),
      (rows) => rows[0]?.status === "timed_out",
    );
    const [runRow] = await sql`select status from standup_runs where standup_id = ${s.id}`;
    expect(runRow.status).toBe("completed");

    const [aRow] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER_A}`;
    expect(aRow.status).toBe("completed");
    expect(aRow.channel_post_ts).not.toBeNull(); // A was broadcast

    // B was NOT broadcast (no threaded channel reply with B's display name / no post ts)
    const [bRow] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER_B}`;
    expect(bRow.channel_post_ts).toBeNull();
  });
});
```

- [ ] **Step 2: Add the root script** — in `package.json` `"scripts"`, add:

```json
    "smoke:edges": "vitest run apps/api/tests/edges-smoke.test.ts packages/db/src/runs.test.ts apps/worker/src/timeoutReport.test.ts"
```

- [ ] **Step 3: Run the smoke** (Redis + Postgres up).

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/api/tests/edges-smoke.test.ts`
Expected: PASS. If it's flaky on timing, bump `STANDUP_TIMEOUT_MS` (e.g. 2000) and/or the `waitFor` timeout — but the deadline must stay well under the waitFor budget.

- [ ] **Step 4: Run the full suite** — confirm no regression. Note `STANDUP_TIMEOUT_MS` is set inside this smoke's `beforeAll` and deleted in `afterAll`, so it doesn't leak to other suites.

Run: `pnpm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/edges-smoke.test.ts package.json
git commit -m "test(api): smoke:edges — timeout + run completion end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Definition-of-done — docs + Phase 1 complete

**Files:**
- Modify: `README.md`
- Modify: `ContextDB/02_architecture/scheduler.md`
- Modify: `ContextDB/00_index/getting-started.md`
- Create: `ContextDB/08_logs/2026-06-21-step7-timeout-run-completion.md`

- [ ] **Step 1: README** — update the DM Q&A feature line to include the timeout, and note Phase 1 Core is complete. The line currently reads (find the exact text):
```
- [x] Conversational DM Q&A (one question at a time, skip / skip all)
```
Change to:
```
- [x] Conversational DM Q&A (one question at a time, skip / skip all, 4h timeout)
```
Add `STANDUP_TIMEOUT_MS` to the configuration/env prose (default `14400000` = 4h; the per-report timeout deadline; lower it only for testing). If the README has a roadmap/status line, mark **Phase 1 Core complete**.

- [ ] **Step 2: `scheduler.md`** — rewrite the "## Completion & timeout" section to the event-driven model:
  - `timeout-report` — a per-report BullMQ job enqueued by `sendDm`, delayed `STANDUP_TIMEOUT_MS` (4h); on fire it marks a still-`in_progress` report `timed_out`.
  - **Run completion is event-driven** via `finalizeRunIfDone` (in `@poddaily/db`), called from both the timeout handler and the api on report completion — it marks the run `completed` once all reports are terminal. There is **no separate `complete-run` timer job**.
  - `timed_out` partials are never broadcast.
  Also update the "Jobs:" bullet near the top (line ~11) from "`send-standup-dm`, `complete-run`, and a timeout sweeper" to "`open-run`, `send-dm`, and `timeout-report`".

- [ ] **Step 3: `getting-started.md`** — add a short "Step 7 — timeout & completion" note: a member who never finishes their DM is marked `timed_out` after 4h (`STANDUP_TIMEOUT_MS`) and is not broadcast; the run closes once all members are done or timed out. Mention `pnpm smoke:edges` covers it and that `STANDUP_TIMEOUT_MS` can be set small to test quickly.

- [ ] **Step 4: Build log** — create `ContextDB/08_logs/2026-06-21-step7-timeout-run-completion.md` (follow the prior logs' structure): What shipped (`finalizeRunIfDone`, `timeout-report` job + handler, `sendDm` enqueue, `handleMessage` finalize, `smoke:edges`), Verification (`pnpm test` totals + `pnpm smoke:edges`), Notable decisions (per-report delayed job over periodic sweeper; event-driven completion replacing the timer-based `complete-run`; `STANDUP_TIMEOUT_MS` read at call time; partials never broadcast by construction; no new schema), an honest DoD (automated green; **live runbook pending** — walk it with a short `STANDUP_TIMEOUT_MS`), and a note that **Phase 1 Core is now feature-complete** (all 7 build steps done; the only remaining gates are the live runbook walks).

- [ ] **Step 5: Final verification**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm test`
Expected: all green. If anything fails, STOP and report.

- [ ] **Step 6: Commit**

```bash
git add README.md ContextDB/02_architecture/scheduler.md ContextDB/00_index/getting-started.md ContextDB/08_logs/2026-06-21-step7-timeout-run-completion.md
git commit -m "docs: Step 7 — timeout + run completion (README, scheduler, runbook, log); Phase 1 feature-complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (against the [Step 7 spec](../specs/2026-06-20-step7-timeout-run-completion-design.md)):
- `finalizeRunIfDone` (all-terminal → completed; in_progress → no-op; idempotent; zero-report) → Task 1. ✓
- `timeout-report` handler (in_progress → timed_out + finalize; no-op when terminal) → Task 2. ✓
- `sendDm` enqueues the timeout (`STANDUP_TIMEOUT_MS`, read at call time; not on redelivery) → Task 3. ✓
- processor dispatches `timeout-report` + provides `enqueueTimeout` → Task 3. ✓
- `handleMessage` finalizes on completion (best-effort) → Task 4. ✓
- Partials never broadcast (timed_out never hits complete branch) → by construction; asserted in `smoke:edges` (B's `channel_post_ts` null) → Task 5. ✓
- `smoke:edges` (timeout + completion + answerer broadcast) + script → Task 5. ✓
- DoD: README (timeout + `STANDUP_TIMEOUT_MS`), scheduler doc rewrite, getting-started, build log, Phase 1 complete → Task 6. ✓
- No new schema → confirmed (reuses `standup_runs.status`/`completed_at`, `standup_reports.status`). ✓

**Placeholder scan:** every code step has complete code; doc steps name exact edits. Tasks 3/4/5 say "use the file's real seeded names / update existing calls" because they extend existing tests with established fixtures — the new code is concrete. ✓

**Type consistency:** `TimeoutJob { runId, slackUserId }` defined in Task 2, used in Tasks 2/3 (queue, processor, sendDm enqueue). `EnqueueTimeout` defined Task 2, added to `SendDmDeps` in Task 3, supplied by the processor (Task 3) and the sendDm tests. `finalizeRunIfDone(db, runId): Promise<boolean>` defined Task 1, called in Tasks 2 (worker) and 4 (api). `makeEnqueueTimeout(queue)` (Task 3) produces the `EnqueueTimeout`. The `timeout-report` job name is consistent across queue.add (Task 3), the processor dispatch (Task 3), and the handler. ✓
