# Inactivity-Based Standup Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop timing out members mid-conversation. The per-report timeout becomes an inactivity timeout: every reply resets the clock to the full `STANDUP_TIMEOUT_MS`.

**Architecture:** A nullable `standup_reports.timeout_at` deadline is set when the report is created (`sendDm`/`retrigger`) and bumped on each answer (`handleMessage`'s `next` branch; the api reads `STANDUP_TIMEOUT_MS`). The `timeoutReport` worker job, on firing, re-reads `timeout_at` and **re-enqueues itself** if the deadline has moved into the future — only timing out after a full window of silence.

**Tech Stack:** Drizzle + drizzle-kit migration, BullMQ, Vitest.

Source: [inactivity-timeout spec](../specs/2026-06-26-inactivity-timeout-design.md).

---

## File Structure

```
packages/db/src/schema.ts (+ migrations/000N_*.sql + meta)   # timeout_at
apps/worker/src/timeoutReport.ts (+ test) + processor.ts     # self-reschedule + enqueueTimeout dep
apps/worker/src/sendDm.ts · retrigger.ts (+ their tests)     # set timeout_at on create/reset
apps/api/src/handleMessage.ts (+ test)                       # bump timeout_at on each answer
README.md · ContextDB/08_logs/2026-06-26-inactivity-timeout.md   # DoD
```

---

### Task 1: Schema — `timeout_at` column + migration

**Files:** Modify `packages/db/src/schema.ts`; generated migration.

- [ ] **Step 1: Add the column** — in `packages/db/src/schema.ts`, in the `standupReports` table (after `createdAt`, before the table's index callback), add:

```ts
  timeoutAt: timestamp("timeout_at", { withTimezone: true }),
```
(`timestamp` is already imported. Nullable — no `.notNull()`.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @poddaily/db generate`
Expected: a new `packages/db/migrations/0004_*.sql` + meta snapshot. Open the `.sql` and confirm it is `ALTER TABLE "standup_reports" ADD COLUMN "timeout_at" timestamp with time zone;`.

- [ ] **Step 3: Apply it**

Run: `DATABASE_URL=$DATABASE_URL pnpm --filter @poddaily/db migrate` (the migrate command needs `DATABASE_URL`/`DIRECT_URL` exported; use the local Postgres URL the other tests use, e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
Expected: applies cleanly.

- [ ] **Step 4: Verify**

```
docker compose up -d redis >/dev/null 2>&1
pnpm exec vitest run packages/db/src/schema.test.ts apps/worker/src/timeoutReport.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: pass / clean (existing timeoutReport tests still pass — the new nullable column defaults to null and the current handler ignores it).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): standup_reports.timeout_at (inactivity deadline)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Self-rescheduling `timeoutReport`

**Files:** Modify `apps/worker/src/timeoutReport.ts`, `apps/worker/src/processor.ts`; Test `apps/worker/src/timeoutReport.test.ts`.

- [ ] **Step 1: Rewrite the test** — replace `apps/worker/src/timeoutReport.test.ts` with a version that injects an `enqueueTimeout` spy, lets `seed` set `timeout_at`, and covers reschedule vs time-out:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { timeoutReport } from "./timeoutReport";

const { db, sql } = createDb();
const CHAN = "C_TIMEOUT_TEST";
const USER = "U_TIMEOUT";

function fakeEnqueueTimeout() {
  const calls: Array<{ job: { runId: string; slackUserId: string }; delayMs: number }> = [];
  const fn = async (job: { runId: string; slackUserId: string }, opts: { delayMs: number }) => { calls.push({ job, delayMs: opts.delayMs }); };
  return Object.assign(fn, { calls });
}

async function seed(reportStatus: string, timeoutAt: Date | null): Promise<{ runId: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('TO Pod', ${CHAN}, 'to') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, timeout_at) values (${run.id}, ${USER}, 'R', ${JSON.stringify([])}, ${reportStatus}, ${timeoutAt})`;
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
  it("times out an in_progress report past its deadline and finalizes the run", async () => {
    const { runId } = await seed("in_progress", new Date(Date.now() - 1000)); // deadline in the past
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(enqueueTimeout.calls).toHaveLength(0);
  });

  it("times out when timeout_at is null (legacy row)", async () => {
    const { runId } = await seed("in_progress", null);
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
  });

  it("reschedules (does NOT time out) when the deadline has moved into the future", async () => {
    const { runId } = await seed("in_progress", new Date(Date.now() + 60_000)); // replied since → +1min
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress"); // not timed out
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0].delayMs).toBeGreaterThan(0);
    expect(enqueueTimeout.calls[0].delayMs).toBeLessThanOrEqual(60_000);
  });

  it("is a no-op when the report already completed", async () => {
    const { runId } = await seed("completed", new Date(Date.now() - 1000));
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("completed");
    expect(enqueueTimeout.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/worker/src/timeoutReport.test.ts` → FAIL (deps shape / reschedule not implemented).

- [ ] **Step 3: Implement** — replace `apps/worker/src/timeoutReport.ts` body:

```ts
import { schema, eq, and, finalizeRunIfDone } from "@poddaily/db";
import type { Db, TimeoutJob, EnqueueTimeout } from "./types";

export interface TimeoutReportDeps {
  db: Db;
  enqueueTimeout: EnqueueTimeout;
}

/**
 * Time out a member's report if it's still in_progress AND its (inactivity) deadline has
 * passed. If the member has replied since this job was enqueued, `timeout_at` has moved into
 * the future — re-enqueue this job for the new deadline instead of timing out. No-op if the
 * report already finished/aborted. A null `timeout_at` (legacy row) times out immediately.
 */
export async function timeoutReport(deps: TimeoutReportDeps, job: TimeoutJob): Promise<void> {
  const { db, enqueueTimeout } = deps;
  const [report] = await db
    .select({ id: schema.standupReports.id, status: schema.standupReports.status, timeoutAt: schema.standupReports.timeoutAt })
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.runId, job.runId),
      eq(schema.standupReports.slackUserId, job.slackUserId),
    ));
  if (!report || report.status !== "in_progress") return;

  if (report.timeoutAt) {
    const remainingMs = report.timeoutAt.getTime() - Date.now();
    if (remainingMs > 0) {
      await enqueueTimeout({ runId: job.runId, slackUserId: job.slackUserId }, { delayMs: remainingMs });
      return;
    }
  }

  await db
    .update(schema.standupReports)
    .set({ status: "timed_out" })
    .where(eq(schema.standupReports.id, report.id));

  await finalizeRunIfDone(db, job.runId);
}
```

- [ ] **Step 4: Wire the processor** — in `apps/worker/src/processor.ts`, the `timeout-report` branch currently calls `await timeoutReport({ db }, job.data as TimeoutJob);`. Change it to pass `enqueueTimeout` (already built as `const enqueueTimeout = makeEnqueueTimeout(queue);`):

```ts
      await timeoutReport({ db, enqueueTimeout }, job.data as TimeoutJob);
```

- [ ] **Step 5: Run, verify PASS + type-check**

```
pnpm exec vitest run apps/worker/src/timeoutReport.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: 4 pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/timeoutReport.ts apps/worker/src/timeoutReport.test.ts apps/worker/src/processor.ts
git commit -m "feat(worker): self-rescheduling timeout — only fire after real inactivity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Set `timeout_at` on report creation (`sendDm` + `retrigger`)

**Files:** Modify `apps/worker/src/sendDm.ts`, `apps/worker/src/retrigger.ts`; Test `apps/worker/src/sendDm.test.ts`, `apps/worker/src/retrigger.test.ts`.

- [ ] **Step 1: `sendDm`** — `apps/worker/src/sendDm.ts` computes `const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);` near the end (just before `enqueueTimeout`). Move that line to **before** the `db.insert(schema.standupReports)` call, and add `timeoutAt` to the inserted values:

```ts
      answers: [],
      status: "in_progress",
      dmThreadTs: firstTs ?? q1Ts,
      timeoutAt: new Date(Date.now() + timeoutMs),
```
(Leave the existing `await enqueueTimeout(...)` / `await enqueueReminders(...)` using the same `timeoutMs`; just don't re-declare it.)

- [ ] **Step 2: `retrigger`** — `apps/worker/src/retrigger.ts` computes `const timeoutMs = ...` after its `db.insert(...).onConflictDoUpdate(...)`. Move that declaration to **before** the insert, and add `timeoutAt: new Date(Date.now() + timeoutMs)` to BOTH the `.values({ ... })` object and the `onConflictDoUpdate` `set: { ... }` object:

```ts
    .values({ runId: run.id, slackUserId: job.slackUserId, slackDisplayName: job.slackDisplayName, answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts, timeoutAt: new Date(Date.now() + timeoutMs) })
    .onConflictDoUpdate({
      target: [schema.standupReports.runId, schema.standupReports.slackUserId],
      set: { answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts, reportedAt: null, timeoutAt: new Date(Date.now() + timeoutMs) },
    });
```
(Keep the later `enqueueTimeout`/`enqueueReminders` using the same `timeoutMs` — just remove the now-duplicate declaration.)

- [ ] **Step 3: Add assertions** —
  - In `apps/worker/src/sendDm.test.ts`, in the existing "opens a DM, posts intro + interpolated Q1, inserts an in_progress report" test, after fetching the report row add:
```ts
    const [rep] = await sql`select timeout_at from standup_reports where slack_user_id = 'U_SEND'`;
    expect(rep.timeout_at).not.toBeNull();
    expect(new Date(rep.timeout_at).getTime()).toBeGreaterThan(Date.now());
```
  - In `apps/worker/src/retrigger.test.ts`, in the first test ("resets a timed_out report to in_progress…"), after the existing assertions add:
```ts
    const [rep] = await sql`select timeout_at from standup_reports where slack_user_id = ${USER}`;
    expect(rep.timeout_at).not.toBeNull();
    expect(new Date(rep.timeout_at).getTime()).toBeGreaterThan(Date.now());
```

- [ ] **Step 4: Verify**

```
docker compose up -d redis >/dev/null 2>&1
pnpm exec vitest run apps/worker/src/sendDm.test.ts apps/worker/src/retrigger.test.ts apps/worker/tests/standup-outbound-smoke.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: all pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/sendDm.ts apps/worker/src/retrigger.ts apps/worker/src/sendDm.test.ts apps/worker/src/retrigger.test.ts
git commit -m "feat(worker): stamp timeout_at when a report's clock starts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Bump `timeout_at` on each answer (api)

**Files:** Modify `apps/api/src/handleMessage.ts`; Test `apps/api/src/handleMessage.test.ts`.

- [ ] **Step 1: Write the failing test** — append inside the `describe("handleMessage", ...)` block in `apps/api/src/handleMessage.test.ts`. The `beforeEach` seeds a fresh `in_progress` report for `USER` on `runId` (with `timeout_at` null). Sending an answer that advances should set `timeout_at` in the future:

```ts
  it("bumps timeout_at forward when an answer advances the report", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, enqueueRetrigger: noEnq, makeUserSlack }, { slackUserId: USER, channel: DM, text: "first answer" });
    const [r] = await sql`select status, timeout_at from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress"); // 2-question standup → advanced, not completed
    expect(r.timeout_at).not.toBeNull();
    expect(new Date(r.timeout_at).getTime()).toBeGreaterThan(Date.now());
  });
```
(Use the file's real `noEnq`/`makeUserSlack`/`fakeSlack`/`USER`/`DM`/`SECRET`. The seeded standup has 2 questions, so one answer advances to Q2 — status stays `in_progress`.)

- [ ] **Step 2: Run, verify it FAILS** — `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/api/src/handleMessage.test.ts` → the new test FAILS (`timeout_at` still null).

- [ ] **Step 3: Implement** — in `apps/api/src/handleMessage.ts`:
  - Add a constant near the top (after the imports / alongside `DEFAULT_OUTRO`): `const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;`
  - In the `next` case, compute the timeout and add `timeoutAt` to the update:
```ts
    case "next": {
      const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);
      await db.update(schema.standupReports)
        .set({ answers: action.answers, timeoutAt: new Date(Date.now() + timeoutMs) })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, action.question.text);
      return;
    }
```
(Note the added braces around the `case` block so the `const` is scoped.)

- [ ] **Step 4: Run, verify PASS + type-check**

```
pnpm exec vitest run apps/api/src/handleMessage.test.ts
pnpm --filter @poddaily/api exec tsc --noEmit
```
Expected: all pass (the existing 16 + the new one); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handleMessage.ts apps/api/src/handleMessage.test.ts
git commit -m "fix(api): reset the inactivity deadline on each standup answer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Definition-of-done — docs + full verify

**Files:** Modify `README.md`; Create `ContextDB/08_logs/2026-06-26-inactivity-timeout.md`.

- [ ] **Step 1: README** — find the `STANDUP_TIMEOUT_MS` note (in the Configuration section) and update it: the timeout is now an **inactivity** timeout — it resets each time a member replies, so they're only timed out after `STANDUP_TIMEOUT_MS` of *silence* (not a fixed deadline from when the DM was sent). Add that `STANDUP_TIMEOUT_MS` must be set to the **same value on both the `api` and `worker`** services (the api stamps the reset deadline).

- [ ] **Step 2: Build log** — create `ContextDB/08_logs/2026-06-26-inactivity-timeout.md` (follow prior logs): the bug (fixed send-anchored deadline, never re-armed → mid-conversation timeout → stale bot), the fix (`timeout_at` column; set on create in `sendDm`/`retrigger`; bumped on each answer in `handleMessage`; self-rescheduling `timeoutReport`), Verification (`pnpm test` totals), and the deploy note (`STANDUP_TIMEOUT_MS` on both `api` + `worker`; migration `0004`).

- [ ] **Step 3: Full verification**

```
DATABASE_URL=$DATABASE_URL pnpm --filter @poddaily/db migrate
docker compose up -d redis >/dev/null 2>&1
pnpm test
```
Expected: all green — paste totals. If anything fails, STOP and report. (Note: the `oauth-state` test was recently de-flaked; a fresh failure there is unexpected.)

- [ ] **Step 4: Commit**

```bash
git add README.md ContextDB/08_logs/2026-06-26-inactivity-timeout.md
git commit -m "docs: inactivity-based standup timeout (README, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `timeout_at` column (nullable) + migration → Task 1. ✓
- Set `timeout_at` on create (`sendDm` + `retrigger`, incl. the reset `set`) → Task 3. ✓
- Bump `timeout_at` on each answer (api `next`, reads `STANDUP_TIMEOUT_MS`) → Task 4. ✓
- Self-rescheduling handler (future deadline → re-enqueue; past/null → time out) → Task 2. ✓
- `enqueueTimeout` dep + processor wiring → Task 2. ✓
- Legacy null rows time out; no infinite loop (`remainingMs > 0` guard) → Task 2 (test + impl). ✓
- Deploy note (`STANDUP_TIMEOUT_MS` on api+worker) → Task 5. ✓
- Tests for all four behaviors → Tasks 2, 3, 4. ✓

**Placeholder scan:** every code step has complete code; migration filename auto-generated (Task 1 verifies the SQL). No TBDs. ✓

**Type consistency:** `TimeoutReportDeps` becomes `{ db, enqueueTimeout }` (Task 2), supplied by the processor (Task 2) and the test spy (Task 2). `timeoutAt` (camel) ↔ `timeout_at` (snake) column (Task 1) used in `sendDm`/`retrigger` inserts (Task 3), the `handleMessage` update (Task 4), and the `timeoutReport` select (Task 2). `timeoutMs` is computed before the insert in `sendDm`/`retrigger` (Task 3) and in the api `next` branch (Task 4), all with the `STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS` pattern. ✓
