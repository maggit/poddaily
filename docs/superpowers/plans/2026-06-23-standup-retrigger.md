# Standup Re-trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can re-start their own standup for today by DMing the bot a keyword (`redo`/`restart`/`start`/`standup`) — the api enqueues a `retrigger` job and the worker ensures the run is open, resets the member's report to a fresh `in_progress`, re-sends Q1, and schedules a new 4h timeout.

**Architecture:** Worker job (Approach A). The api detects the keyword (where it currently ignores an unanswered DM), blocks if already completed, and enqueues a `retrigger` job via a BullMQ queue. The worker's `retrigger` handler reuses an extracted `ensureRunOpen` (from `openRun`) plus the existing timeout machinery; it re-sends the DM with a self-contained posting block (no change to the live `sendDm` path). `QUEUE_NAME` + the job type move to `@poddaily/shared` so the api can enqueue without importing `apps/worker`.

**Tech Stack:** `@slack/bolt` api, BullMQ (`bullmq`), Drizzle (`@poddaily/db`), `@poddaily/shared`, Vitest, real Redis + Postgres + the `tools/slack-stub`.

Source: [Re-trigger spec](../specs/2026-06-23-standup-retrigger-design.md).

> **Scope notes:** keyword only (no slash command/button → no Slack config change); self-scoped; incomplete-only (block completed); ensure-run-but-DM-only-me; **the live `sendDm` path is NOT refactored** — the retrigger handler re-implements the small posting block itself (reusing the shared interpolation helpers), to avoid regression risk on the critical daily-send path. No new schema. `bullmq` becomes an api dependency (the api already has `REDIS_URL`).

---

## File Structure

```
packages/shared/src/queue-contract.ts (+ index re-export)   # QUEUE_NAME + RetriggerJob type
apps/worker/src/queue.ts                                     # re-export QUEUE_NAME from shared
apps/worker/src/openRun.ts (+ test)                          # extract ensureRunOpen
apps/worker/src/types.ts                                     # (RetriggerJob re-export convenience)
apps/worker/src/retrigger.ts (+ test)                        # the retrigger job handler
apps/worker/src/processor.ts                                 # dispatch "retrigger"
apps/api/package.json                                        # bullmq devDep → dependency
apps/api/src/handleMessage.ts (+ test)                       # keyword detection + enqueue + acks
apps/api/src/index.ts                                        # api Queue + enqueueRetrigger wiring
apps/api/tests/retrigger-smoke.test.ts                       # end-to-end
README.md · ContextDB/* · build log                          # DoD
```

---

### Task 1: Shared queue contract

Move `QUEUE_NAME` and add the `RetriggerJob` type to `@poddaily/shared` so the api can enqueue without importing `apps/worker` (its Docker image doesn't include the worker).

**Files:** Create `packages/shared/src/queue-contract.ts`; Modify `packages/shared/src/index.ts`, `apps/worker/src/queue.ts`.

- [ ] **Step 1: Create `packages/shared/src/queue-contract.ts`**

```ts
/** The single BullMQ queue name shared by the worker (consumer) and the api (producer). */
export const QUEUE_NAME = "standup";

/** Payload for a `retrigger` job — re-start one member's standup for today. */
export interface RetriggerJob {
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
  channel: string; // the DM channel to ack into (unused by the worker, carried for completeness)
}
```

- [ ] **Step 2: Re-export from the shared barrel** — add to `packages/shared/src/index.ts`:

```ts
export * from "./queue-contract";
```

- [ ] **Step 3: Use the shared `QUEUE_NAME` in the worker** — in `apps/worker/src/queue.ts`, replace `export const QUEUE_NAME = "standup";` with a re-export so existing importers (`./queue`) keep working:

```ts
import { Queue } from "bullmq";
import { QUEUE_NAME } from "@poddaily/shared";
import type { SendDmJob, EnqueueSend, TimeoutJob, EnqueueTimeout } from "./types";

export { QUEUE_NAME };
```
(The rest of `queue.ts` is unchanged — `createQueue`/`makeEnqueueSend`/`makeEnqueueTimeout`/`enqueueOpenRun` still use the now-imported `QUEUE_NAME`.)

- [ ] **Step 4: Verify** — type-check + the worker tests still pass (no behavior change):

```
pnpm exec vitest run packages/shared/src/dmEngine.test.ts apps/worker/src/reconcile.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: pass / clean. (Constant + type move — no new test; verified by existing tests + tsc.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/queue-contract.ts packages/shared/src/index.ts apps/worker/src/queue.ts
git commit -m "refactor(shared): move QUEUE_NAME + add RetriggerJob to @poddaily/shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extract `ensureRunOpen` from `openRun`

`openRun` currently opens the run, posts the opening message, and fans out — and bails (returns null) if the run already exists. Extract the **open-or-fetch + opening-message** part as `ensureRunOpen`, returning `{ run, created }`, reusable by the retrigger handler. Behavior-preserving for the scheduled path.

**Files:** Modify `apps/worker/src/openRun.ts`; Test `apps/worker/src/openRun.test.ts`.

- [ ] **Step 1: Write the failing test** — add to `apps/worker/src/openRun.test.ts` (it already seeds a team/standup; reuse its helpers/`sql`/`fakeSlack`):

```ts
import { ensureRunOpen } from "./openRun";

it("ensureRunOpen opens a run with an opening message, and returns the existing run on a second call", async () => {
  // seed a fresh team + standup (reuse the file's seed helper; here inline for clarity)
  const slack = fakeSlack();
  const [standupRow] = await sql`select * from standups where id = ${standupId}`; // the file's seeded standup id
  const first = await ensureRunOpen({ db, slack }, standupRow, new Date());
  expect(first.created).toBe(true);
  expect(first.run.id).toBeTruthy();
  expect(slack.posts.some((p) => p.text.includes("Reported: 0 out of"))).toBe(true);

  const second = await ensureRunOpen({ db, slack }, standupRow, new Date());
  expect(second.created).toBe(false);
  expect(second.run.id).toBe(first.run.id); // same run, not a duplicate
});
```
(Adapt `standupId`/the seed to the file's real fixtures — the file already creates a standup row for its happy-path test. Ensure no run exists for that standup+today before the first call, e.g. delete runs for it first.)

- [ ] **Step 2: Run from repo root, confirm FAIL** (ensureRunOpen not exported). `pnpm exec vitest run apps/worker/src/openRun.test.ts`

- [ ] **Step 3: Implement** — in `apps/worker/src/openRun.ts`, add `ensureRunOpen` and refactor `openRun` to use it:

```ts
import { schema, eq, and } from "@poddaily/db";
import { anchorDate, isActiveWeekday, computeSendInstant, buildOpeningMessage } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { Db, OpenRunDeps } from "./types";

export interface OpenRunResult { runId: string | null; enqueued: number; }

/**
 * Open today's run for a standup (idempotent on standup_id+scheduled_date), posting the
 * channel opening message on first open, and return the run plus whether THIS call created
 * it. Does NOT fan out to members — callers decide (openRun fans out; retrigger sends to one).
 */
export async function ensureRunOpen(
  deps: { db: Db; slack: SlackClient },
  standup: typeof schema.standups.$inferSelect,
  now: Date,
): Promise<{ run: typeof schema.standupRuns.$inferSelect; created: boolean }> {
  const { db, slack } = deps;
  const date = anchorDate(standup.scheduleTz, now);

  const inserted = await db
    .insert(schema.standupRuns)
    .values({ standupId: standup.id, scheduledAt: now, scheduledDate: date, status: "running", startedAt: now })
    .onConflictDoNothing({ target: [schema.standupRuns.standupId, schema.standupRuns.scheduledDate] })
    .returning();

  if (inserted.length === 0) {
    const [existing] = await db.select().from(schema.standupRuns)
      .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, date)));
    return { run: existing, created: false };
  }

  const run = inserted[0];
  // Best-effort opening message (the "total" = count of reporting members).
  try {
    if (standup.teamId) {
      const [team] = await db.select({ channelId: schema.teams.slackChannelId }).from(schema.teams).where(eq(schema.teams.id, standup.teamId));
      const reporters = await db.select({ id: schema.teamMembers.id }).from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.canReport, true)));
      if (team?.channelId) {
        const opening = buildOpeningMessage({ standupName: standup.name, date, reported: 0, total: reporters.length });
        const openingTs = await slack.postMessage(team.channelId, opening.text, { blocks: opening.blocks });
        await db.update(schema.standupRuns).set({ channelOpeningTs: openingTs }).where(eq(schema.standupRuns.id, run.id));
        run.channelOpeningTs = openingTs;
      }
    }
  } catch (err) {
    console.warn(`[broadcast] opening message failed for run ${run.id}:`, (err as Error).message);
  }

  return { run, created: true };
}

/**
 * Open today's run and fan out a send-standup-dm job per reporting member. Idempotent: a
 * second tick the same day opens nothing and fans out nothing.
 */
export async function openRun(deps: OpenRunDeps, standupId: string, now: Date): Promise<OpenRunResult> {
  const { db, enqueueSend, slack } = deps;

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup || !standup.isActive) return { runId: null, enqueued: 0 };
  if (!standup.teamId) return { runId: null, enqueued: 0 };
  if (!isActiveWeekday(standup.scheduleCron, standup.scheduleTz, now)) return { runId: null, enqueued: 0 };

  const { run, created } = await ensureRunOpen({ db, slack }, standup, now);
  if (!created) return { runId: null, enqueued: 0 }; // already open today — don't re-fan-out

  const date = run.scheduledDate;
  const members = await db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.canReport, true)));
  for (const m of members) {
    const tz = m.timezone ?? standup.scheduleTz;
    const sendAt = computeSendInstant(standup.scheduleCron, tz, date);
    const delayMs = Math.max(0, sendAt.getTime() - now.getTime());
    await enqueueSend({ runId: run.id, standupId, slackUserId: m.slackUserId, slackDisplayName: m.slackDisplayName }, { delayMs });
  }
  return { runId: run.id, enqueued: members.length };
}
```
(`Db` is exported from `apps/worker/src/types.ts`. The opening message + fan-out behavior is unchanged for the scheduled path — verified by the existing `openRun.test.ts` + `standup-outbound-smoke`.)

- [ ] **Step 4: Run from repo root, confirm PASS** — the existing openRun tests + the new ensureRunOpen test:

```
pnpm exec vitest run apps/worker/src/openRun.test.ts
docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/worker/tests/standup-outbound-smoke.test.ts
```
Expected: all pass (behavior preserved).

- [ ] **Step 5: Type-check the worker:** `pnpm --filter @poddaily/worker exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/openRun.ts apps/worker/src/openRun.test.ts
git commit -m "refactor(worker): extract ensureRunOpen from openRun

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Worker `retrigger` handler

**Files:** Create `apps/worker/src/retrigger.ts`; Modify `apps/worker/src/processor.ts`; Test `apps/worker/src/retrigger.test.ts`.

- [ ] **Step 1: Write the failing test** — `apps/worker/src/retrigger.test.ts` (real PG; fake slack + enqueueTimeout):

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { retrigger } from "./retrigger";

const { db, sql } = createDb();
const CHAN = "C_RETRIG_TEST";
const USER = "U_RETRIG";

function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return { posts, openDm: async () => "D_RT", postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts_rt"; }, updateMessage: async () => {}, getUserProfile: async () => ({ image: null, tz: null, realName: null }) };
}
function fakeEnqueueTimeout() {
  const calls: Array<{ runId: string; slackUserId: string }> = [];
  const fn = async (job: { runId: string; slackUserId: string }) => { calls.push(job); };
  return Object.assign(fn, { calls });
}

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function seed(opts: { run?: "completed-run" | "no-run"; report?: "timed_out" | "none" }): Promise<{ standupId: string; runId?: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('RT Pod', ${CHAN}, 'rt') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'RT Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])}, '0 10 * * 1', 'UTC', 'Morning!', true) returning id`;
  if (opts.run === "no-run") return { standupId: s.id };
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, channel_opening_ts) values (${s.id}, now(), current_date, 'completed', 'open_rt') returning id`;
  if (opts.report === "timed_out") {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'RT Tester', ${JSON.stringify([])}, 'timed_out')`;
  }
  return { standupId: s.id, runId: run.id };
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("retrigger", () => {
  it("resets a timed_out report to in_progress, re-sends Q1, sets run running, schedules a timeout", async () => {
    const { standupId, runId } = await seed({ report: "timed_out" });
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    await retrigger({ db, slack, enqueueTimeout }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("running");
    expect(slack.posts.some((p) => p.text === "What did you do?")).toBe(true); // Q1 re-sent
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0]).toEqual({ runId, slackUserId: USER });
  });

  it("opens the run + creates the report when no run exists yet", async () => {
    const { standupId } = await seed({ run: "no-run" });
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    await retrigger({ db, slack, enqueueTimeout }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [run] = await sql`select status from standup_runs where standup_id = ${standupId} and scheduled_date = current_date`;
    expect(run.status).toBe("running");
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
  });
});
```

- [ ] **Step 2: Run from repo root, confirm FAIL** (module not found).

- [ ] **Step 3: Implement** — `apps/worker/src/retrigger.ts`

```ts
import { schema, eq, lastReportDateBefore } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import type { RetriggerJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import { ensureRunOpen } from "./openRun";
import type { Db, EnqueueTimeout } from "./types";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface RetriggerDeps {
  db: Db;
  slack: SlackClient;
  enqueueTimeout: EnqueueTimeout;
}

/**
 * Re-start one member's standup for today: ensure the run is open, reset/create their report
 * to a fresh in_progress, re-send intro + Q1, set the run back to running, and schedule a new
 * timeout. Self-contained posting (doesn't touch the live sendDm path). Idempotent on retry.
 */
export async function retrigger(deps: RetriggerDeps, job: RetriggerJob): Promise<void> {
  const { db, slack, enqueueTimeout } = deps;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, job.standupId));
  if (!standup || !standup.isActive || !standup.teamId) return;
  const firstQuestion = standup.questions[0];
  if (!firstQuestion) return;

  const { run } = await ensureRunOpen({ db, slack }, standup, new Date());

  const lastDate = await lastReportDateBefore(db, job.slackUserId, new Date());
  const q1Text = interpolateLastReportDate(firstQuestion.text, lastDate);

  const channelId = await slack.openDm(job.slackUserId);
  let firstTs: string | null = null;
  if (standup.introMessage) firstTs = await slack.postMessage(channelId, standup.introMessage);
  const q1Ts = await slack.postMessage(channelId, q1Text);

  await db.insert(schema.standupReports)
    .values({ runId: run.id, slackUserId: job.slackUserId, slackDisplayName: job.slackDisplayName, answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts })
    .onConflictDoUpdate({
      target: [schema.standupReports.runId, schema.standupReports.slackUserId],
      set: { answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts, reportedAt: new Date() },
    });

  // The run may have been completed by the timeout sweeper — re-open it.
  await db.update(schema.standupRuns).set({ status: "running" }).where(eq(schema.standupRuns.id, run.id));

  const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);
  await enqueueTimeout({ runId: run.id, slackUserId: job.slackUserId }, { delayMs: timeoutMs });
}
```

- [ ] **Step 4: Dispatch it in the processor** — in `apps/worker/src/processor.ts`, add the import + a branch:

```ts
import { retrigger } from "./retrigger";
import type { RetriggerJob } from "@poddaily/shared";
// ...inside the dispatch, after the timeout-report branch:
    } else if (job.name === "retrigger") {
      await retrigger({ db, slack, enqueueTimeout }, job.data as RetriggerJob);
```
(`enqueueTimeout` is already built in `createProcessor`.)

- [ ] **Step 5: Run from repo root, confirm PASS** (2 tests). Type-check worker.

```
pnpm exec vitest run apps/worker/src/retrigger.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/retrigger.ts apps/worker/src/retrigger.test.ts apps/worker/src/processor.ts
git commit -m "feat(worker): retrigger handler — re-open a member's standup for today

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: api — keyword detection + enqueue

**Files:** Modify `apps/api/package.json`, `apps/api/src/handleMessage.ts`, `apps/api/src/index.ts`; Test `apps/api/src/handleMessage.test.ts`.

- [ ] **Step 1: Move `bullmq` to an api dependency** — in `apps/api/package.json`, move `"bullmq": "^5.34.0"` from `devDependencies` to `dependencies`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test** — add to `apps/api/src/handleMessage.test.ts`. The existing tests seed a team/standup/run/report and pass deps `{ db, slack, secret, makeUserSlack }`; these need `enqueueRetrigger` added (a spy). Add:

```ts
it("enqueues a retrigger when a member with no open report DMs a keyword", async () => {
  // ensure no in_progress report for USER (the file's beforeEach seeds in_progress — delete it)
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  const calls: any[] = [];
  const enqueueRetrigger = async (job: any) => { calls.push(job); };
  const slack = fakeSlack();
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "redo" });
  expect(calls).toHaveLength(1);
  expect(calls[0].slackUserId).toBe(USER);
  expect(slack.posts.at(-1)?.text).toContain("Restarting");
});

it("replies already-reported (no enqueue) when today's report is completed", async () => {
  // make today's report completed
  await sql`update standup_reports set status = 'completed' where slack_user_id = ${USER}`;
  const calls: any[] = [];
  const enqueueRetrigger = async (job: any) => { calls.push(job); };
  const slack = fakeSlack();
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "redo" });
  expect(calls).toHaveLength(0);
  expect(slack.posts.at(-1)?.text).toContain("already reported");
});

it("ignores a non-keyword stray DM with no open report", async () => {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  const calls: any[] = [];
  const enqueueRetrigger = async (job: any) => { calls.push(job); };
  const slack = fakeSlack();
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "hello there" });
  expect(calls).toHaveLength(0);
  expect(slack.posts).toHaveLength(0);
});
```
(Use the file's real `USER`/`DM`/`SECRET`/`makeUserSlack`/`fakeSlack`. The seeded team/member must exist so the standup lookup resolves — the file seeds a team + the standup + the member; confirm the member row exists. Add `enqueueRetrigger` to the existing `handleMessage(...)` calls too — a no-op `async () => {}` — so they compile.)

- [ ] **Step 3: Run from repo root, confirm the new cases FAIL.**

- [ ] **Step 4: Implement** — in `apps/api/src/handleMessage.ts`:

Update imports + deps:
```ts
import { schema, eq, and, desc, getUserToken, finalizeRunIfDone, lastReportDateBefore, sql as dsql } from "@poddaily/db";
import type { RetriggerJob } from "@poddaily/shared";
```
(If `@poddaily/db` doesn't re-export `sql`, it does — `export { ..., sql } from "drizzle-orm"`. Alias it `dsql` to avoid clashing with the postgres `sql`.)

Extend `HandleMessageDeps`:
```ts
export interface HandleMessageDeps {
  db: Db;
  slack: SlackClient;
  secret: string;
  makeUserSlack: (token: string) => SlackClient;
  enqueueRetrigger: (job: RetriggerJob) => Promise<void>;
}
```

At the no-in-progress-report early return, call `maybeRetrigger` first:
```ts
  if (!report || !report.runId) {
    await maybeRetrigger(deps, msg);
    return;
  }
```

Add the helper at the bottom of the file:
```ts
const RETRIGGER_KEYWORDS = new Set(["redo", "restart", "start", "standup"]);

/**
 * When a member with no open report DMs a re-trigger keyword, (re)start their standup for
 * today — unless they've already completed it. No-op for non-keyword messages.
 */
async function maybeRetrigger(deps: HandleMessageDeps, msg: IncomingDm): Promise<void> {
  const { db, slack, enqueueRetrigger } = deps;
  if (!RETRIGGER_KEYWORDS.has(msg.text.trim().toLowerCase())) return;

  const [member] = await db
    .select({ teamId: schema.teamMembers.teamId, displayName: schema.teamMembers.slackDisplayName })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.slackUserId, msg.slackUserId))
    .limit(1);
  if (!member?.teamId) {
    await slack.postMessage(msg.channel, "You're not set up for a standup yet.");
    return;
  }
  const [standup] = await db.select({ id: schema.standups.id }).from(schema.standups).where(eq(schema.standups.teamId, member.teamId));
  if (!standup) {
    await slack.postMessage(msg.channel, "Your team has no standup configured yet.");
    return;
  }

  // Already completed today? Block.
  const [todayRun] = await db.select({ id: schema.standupRuns.id })
    .from(schema.standupRuns)
    .where(and(eq(schema.standupRuns.standupId, standup.id), dsql`${schema.standupRuns.scheduledDate} = current_date`));
  if (todayRun) {
    const [rep] = await db.select({ status: schema.standupReports.status })
      .from(schema.standupReports)
      .where(and(eq(schema.standupReports.runId, todayRun.id), eq(schema.standupReports.slackUserId, msg.slackUserId)));
    if (rep?.status === "completed") {
      await slack.postMessage(msg.channel, "You've already reported today ✅");
      return;
    }
  }

  await enqueueRetrigger({ standupId: standup.id, slackUserId: msg.slackUserId, slackDisplayName: member.displayName, channel: msg.channel });
  await slack.postMessage(msg.channel, "📋 Restarting your standup…");
}
```

- [ ] **Step 5: Wire the api boot** — in `apps/api/src/index.ts`, create a queue + `enqueueRetrigger` and pass it into `handleMessage` deps:
```ts
import { Queue } from "bullmq";
import { QUEUE_NAME, type RetriggerJob } from "@poddaily/shared";
// ...
const queue = new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
const enqueueRetrigger = (job: RetriggerJob) =>
  queue.add("retrigger", job, { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: false }).then(() => undefined);
// ...in the app.message handler:
  await handleMessage({ db, slack, secret, makeUserSlack, enqueueRetrigger }, { slackUserId: m.user, channel: m.channel, text: m.text });
```
(`process.env.REDIS_URL` is already set on the api in the deploy compose.)

- [ ] **Step 6: Run from repo root, confirm PASS** (existing + 3 new). Type-check api.

```
pnpm exec vitest run apps/api/src/handleMessage.test.ts
pnpm --filter @poddaily/api exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/handleMessage.ts apps/api/src/index.ts apps/api/src/handleMessage.test.ts
git commit -m "feat(api): re-trigger standup on a DM keyword

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `retrigger` smoke — end-to-end

**Files:** Create `apps/api/tests/retrigger-smoke.test.ts`.

- [ ] **Step 1: Write the smoke** — base it on `apps/api/tests/edges-smoke.test.ts` (real worker via `createProcessor` + Redis + stub). Flow: seed a member with a `timed_out` report for today's run → enqueue a `retrigger` job (the worker processes it) → assert the member's report flips back to `in_progress` and Q1 is re-posted to the stub; then drive the answer via `handleMessage` and assert it completes + broadcasts.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { createProcessor } from "../../worker/src/processor";
import { handleMessage } from "../src/handleMessage";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "retrigger-smoke";
const { db, sql } = createDb();
const CHAN = "C_SMOKE_RETRIG";
const USER = "U_SMOKE_RETRIG";
const DM = "D_RETRIG";
const SECRET = "test-internal-api-secret-0123456789";
const makeUserSlack = (token: string) => createSlackClient({ token });

let stub: SlackStub; let queue: Queue; let worker: Worker;

beforeAll(async () => {
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
  await worker.close(); await queue.obliterate({ force: true }); await queue.close(); await stub.close(); await cleanup(); await sql.end();
});
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (pred(v)) return v; if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out"); await new Promise((r) => setTimeout(r, 150)); }
}

describe("smoke:retrigger", () => {
  it("re-opens a timed-out standup and lets the member complete it", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Retrig Pod', ${CHAN}, 'retrig') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'Retrig Tester', 'UTC', true)`;
    const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }, { id: "q2", text: "Today?", type: "text" }])}, '0 10 * * 1', 'UTC', 'Morning!', true) returning id`;
    const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, channel_opening_ts) values (${s.id}, now(), current_date, 'completed', 'open_rt') returning id`;
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'Retrig Tester', ${JSON.stringify([])}, 'timed_out')`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await queue.add("retrigger", { standupId: s.id, slackUserId: USER, slackDisplayName: "Retrig Tester", channel: DM });

    // worker re-opens: report → in_progress, Q1 re-posted
    await waitFor(async () => (await sql`select status from standup_reports where slack_user_id = ${USER}`), (rows) => rows[0]?.status === "in_progress");
    const [runRow] = await sql`select status from standup_runs where id = ${run.id}`;
    expect(runRow.status).toBe("running");

    // member answers both → completes
    const slack = createSlackClient();
    const enqueueRetrigger = async () => {};
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "did it now" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "more today" });
    const [final] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(final.status).toBe("completed");
    expect(final.channel_post_ts).not.toBeNull(); // broadcast on completion
  });
});
```

- [ ] **Step 2: Add a `smoke:retrigger` root script** — in `package.json` `"scripts"`: `"smoke:retrigger": "vitest run apps/api/tests/retrigger-smoke.test.ts apps/worker/src/retrigger.test.ts"`.

- [ ] **Step 3: Run it + the full suite**

```
docker compose up -d redis >/dev/null 2>&1
pnpm exec vitest run apps/api/tests/retrigger-smoke.test.ts
pnpm test
```
Expected: the smoke passes; full suite all green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/retrigger-smoke.test.ts package.json
git commit -m "test(api): smoke:retrigger — re-open a timed-out standup end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Definition-of-done — docs + verify

**Files:** Modify `README.md`, `ContextDB/02_architecture/slack-integration.md`; Create `ContextDB/08_logs/2026-06-23-standup-retrigger.md`.

- [ ] **Step 1: README** — in the bot/usage prose, document the re-trigger keywords: a member who missed/timed-out their standup can DM the bot `redo` (or `restart` / `start` / `standup`) to re-start today's standup; if already done, the bot says so. Note `bullmq` is now an api dependency and the api needs `REDIS_URL` (already set in the compose).

- [ ] **Step 2: `slack-integration.md`** — under the DM Q&A engine section, add a short note: an unanswered keyword (`redo`/…) when there's no open report re-triggers the member's standup (api enqueues a `retrigger` job; the worker re-opens + re-sends).

- [ ] **Step 3: Build log** — create `ContextDB/08_logs/2026-06-23-standup-retrigger.md` (follow prior logs): What shipped (shared queue contract, ensureRunOpen extraction, worker retrigger handler, api keyword detection + enqueue, smoke), Verification (`pnpm test` totals + `pnpm smoke:retrigger`), Notable decisions (DM keyword via the existing message.im path — no Slack config; self-scoped, incomplete-only; ensure-run-but-DM-only-me; worker job — api stays thin; retrigger handler self-contained, NOT a sendDm refactor, to protect the live send path; bullmq now an api dep), honest DoD (automated green; **live walk pending** — time a daily out, DM `redo`, confirm re-ask + completion), and that this is a Phase 2 follow-on (B reminders / C admin controls / D RBAC still in the backlog).

- [ ] **Step 4: Final verification**

```
docker compose up -d redis >/dev/null 2>&1; pnpm test
```
Paste the totals. If anything fails, STOP and report.

- [ ] **Step 5: Commit**

```bash
git add README.md ContextDB/02_architecture/slack-integration.md ContextDB/08_logs/2026-06-23-standup-retrigger.md
git commit -m "docs: standup re-trigger (README, slack-integration, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Keyword detection at the no-open-report path + acks + completed-block → Task 4. ✓
- Self-scoped, incomplete-only → Task 4 (maybeRetrigger). ✓
- Worker job (Approach A): api enqueues, worker handles → Tasks 4 + 3. ✓
- Ensure-run-but-DM-only-me → Task 3 (ensureRunOpen + single-member send, no fan-out). ✓
- ensureRunOpen extraction (behavior-preserving) → Task 2. ✓
- Shared QUEUE_NAME + RetriggerJob (api can't import worker) → Task 1. ✓
- Reset report + run→running + fresh timeout + no double-broadcast (timed_out never broadcast) → Task 3. ✓
- bullmq → api dependency → Task 4. ✓
- smoke + DoD → Tasks 5, 6. ✓
- **Deviation from spec (noted):** the retrigger handler re-implements the DM posting itself instead of refactoring `sendDm`'s core — deliberate, to avoid regression risk on the live daily-send path (the duplication is ~15 lines and the report-write differs: reset vs insert).

**Placeholder scan:** every code step has complete code; the smoke/test steps reuse documented fixtures. No TBDs. ✓

**Type consistency:** `RetriggerJob { standupId, slackUserId, slackDisplayName, channel }` defined in Task 1, used by Task 3 (worker handler), Task 4 (api enqueue + deps), Task 5 (smoke). `ensureRunOpen(deps, standup, now) → { run, created }` defined Task 2, consumed by Task 2 (openRun) + Task 3 (retrigger). `HandleMessageDeps.enqueueRetrigger` added Task 4 and supplied by `index.ts` + every test call. `enqueueTimeout` / `EnqueueTimeout` reused from the existing worker. ✓
