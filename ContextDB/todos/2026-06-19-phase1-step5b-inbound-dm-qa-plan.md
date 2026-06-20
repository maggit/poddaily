# Phase 1 — Step 5b: Inbound DM Q&A Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team member who receives the outbound standup DM (Step 5a) can answer their questions one at a time in the DM; each reply is persisted to `standup_reports.answers`, the next question is posted, and after the last question the report is marked `completed` and an outro is posted — proven end-to-end by `smoke:standup`. Plus: the worker + API + Redis stack is deployed to Dokploy.

**Architecture:** The conversation is **stateless** — progress is reconstructed from `standup_reports.answers` on every event (see [stateless DM ADR](../03_decisions/2026-06-14-stateless-dm-state.md)). The decision logic is a **pure reducer** in `@poddaily/shared` (`advanceReport`), fully unit-tested without Slack or a DB. A new `apps/api` service runs `@slack/bolt`, receives `message.im`, and calls a dependency-injected `handleMessage(deps, msg)` orchestrator that loads the open report, runs the reducer, persists, and posts the next message via `@poddaily/slack-client`. The same `handleMessage` seam is driven directly by `smoke:standup` (Bolt is only transport).

**Tech Stack:** `@slack/bolt` v4 (HTTP receiver + signing-secret verification), Drizzle (`@poddaily/db`, operators re-exported), `@poddaily/shared`, `@poddaily/slack-client`, BullMQ (existing worker), Vitest, the `tools/slack-stub` recorder, Dokploy + Docker Compose.

Source: [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) §5 Slack integration (DM flow) + §7 API surface · [slack-integration.md](../02_architecture/slack-integration.md#dm-qa-engine) · [stateless DM ADR](../03_decisions/2026-06-14-stateless-dm-state.md) · build step 5 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md) · prior step: [2026-06-19-step5a-scheduler-outbound.md](../08_logs/2026-06-19-step5a-scheduler-outbound.md).

> **Scope notes (documented, not gaps):**
> 1. **No channel broadcast.** On `completed`, the engine posts the outro to the **DM only**. The opening-thread message + post-as-user threaded replies are **Step 6**. `report.channelPostTs` stays null.
> 2. **No 4h timeout sweeper.** `skip all` aborts a single conversation to `timed_out` immediately, but the time-based sweep of stale `in_progress` reports is **Step 7**.
> 3. **Stored answer text is raw question text** (e.g. Q1 keeps the literal `{last_report_date}` placeholder). Interpolation is a display concern handled at post time; it does not belong in the persisted reducer output. Broadcast rendering (Step 6) interpolates if needed.
> 4. **Bolt routing is thin and covered indirectly.** The HTTP receiver + signature verification are exercised by the live runbook against a real workspace; the automated `smoke:standup` drives the tested `handleMessage` seam directly (consistent with the spec's "route/job against local Postgres + mocked Slack" integration tier). A redundant signed-HTTP harness against Bolt is intentionally not built.
> 5. **"Open report" lookup = most-recent `in_progress` report for the `slackUserId`.** Phase 1 has one standup per team and a user reports for one team, so the most-recent `in_progress` row is unambiguous. Documented assumption, not a multi-team resolver.

---

## File Structure

```
packages/shared/src/dmEngine.ts          # advanceReport pure reducer + DmAdvance type (+ test)
packages/shared/src/index.ts             # re-export ./dmEngine

apps/api/package.json                     # new service: @slack/bolt + workspace deps
apps/api/tsconfig.json
apps/api/src/handleMessage.ts             # DI orchestrator: load report → advanceReport → persist → post
apps/api/src/handleMessage.test.ts        # integration: real PG + fake slack recorder
apps/api/src/index.ts                     # Bolt app: message.im → handleMessage(realDeps)

apps/api/tests/standup-smoke.test.ts      # smoke:standup — outbound (worker) + inbound (handleMessage) E2E

Dockerfile.api                            # build apps/api
Dockerfile.worker                         # build apps/worker
docker-compose.dokploy.yml                # uncomment/add api + worker + redis services
package.json (root)                       # add "smoke:standup" script
```

The `apps/api` orchestrator reuses the exact dependency-injection shape already used by
`apps/worker/src/sendDm.ts` (`{ db, slack }`), so the engine is testable against the stub.

---

### Task 1: `advanceReport` pure reducer in shared (TDD)

The heart of the engine: given the standup's questions, the answers stored so far, and the
incoming message, decide what happens next. Pure — no Slack, no DB, no clock.

**Files:**
- Create: `packages/shared/src/dmEngine.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/dmEngine.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/dmEngine.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { advanceReport } from "./dmEngine";
import type { Question, ReportAnswer } from "./questions";

const Q: Question[] = [
  { id: "q1", text: "What did you do?", type: "text" },
  { id: "q2", text: "What will you do?", type: "text" },
];

describe("advanceReport", () => {
  it("records the first answer and returns the next question", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "Shipped 5a" });
    expect(out).toEqual({
      kind: "next",
      answers: [{ questionId: "q1", questionText: "What did you do?", answer: "Shipped 5a" }],
      question: Q[1],
    });
  });

  it("completes after the final question is answered", () => {
    const answers: ReportAnswer[] = [
      { questionId: "q1", questionText: "What did you do?", answer: "Shipped 5a" },
    ];
    const out = advanceReport({ questions: Q, answers, message: "Build 5b" });
    expect(out.kind).toBe("complete");
    if (out.kind === "complete") expect(out.answers).toHaveLength(2);
  });

  it("trims whitespace from the answer", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "  hi  " });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("hi");
    else throw new Error("expected next");
  });

  it("`skip` records (skipped) and advances", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "skip" });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("(skipped)");
    else throw new Error("expected next");
  });

  it("`SKIP` is case-insensitive", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "  SKIP " });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("(skipped)");
    else throw new Error("expected next");
  });

  it("`skip all` aborts without recording an answer", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "skip all" });
    expect(out).toEqual({ kind: "abort" });
  });

  it("ignores a message once every question is answered (idempotent redelivery)", () => {
    const answers: ReportAnswer[] = [
      { questionId: "q1", questionText: "What did you do?", answer: "a" },
      { questionId: "q2", questionText: "What will you do?", answer: "b" },
    ];
    expect(advanceReport({ questions: Q, answers, message: "late reply" })).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @poddaily/shared exec vitest run src/dmEngine.test.ts`
Expected: FAIL — "Cannot find module './dmEngine'".

- [ ] **Step 3: Write minimal implementation** — `packages/shared/src/dmEngine.ts`

```ts
import type { Question, ReportAnswer } from "./questions";

/** The decision the engine makes for one incoming DM reply. */
export type DmAdvance =
  | { kind: "next"; answers: ReportAnswer[]; question: Question }
  | { kind: "complete"; answers: ReportAnswer[] }
  | { kind: "abort" }
  | { kind: "noop" };

const SKIP = "skip";
const SKIP_ALL = "skip all";

/**
 * Pure standup-DM reducer. Progress is `answers.length` (the index of the current
 * question). Stateless: the same (questions, answers, message) always yields the same
 * result, so a redelivered Slack event never double-advances.
 */
export function advanceReport(args: {
  questions: Question[];
  answers: ReportAnswer[];
  message: string;
}): DmAdvance {
  const { questions, answers, message } = args;

  // Already finished (or misconfigured with no questions) → ignore stray replies.
  if (answers.length >= questions.length) return { kind: "noop" };

  const normalized = message.trim().toLowerCase();
  if (normalized === SKIP_ALL) return { kind: "abort" };

  const current = questions[answers.length];
  const answerText = normalized === SKIP ? "(skipped)" : message.trim();
  const nextAnswers: ReportAnswer[] = [
    ...answers,
    { questionId: current.id, questionText: current.text, answer: answerText },
  ];

  if (nextAnswers.length >= questions.length) {
    return { kind: "complete", answers: nextAnswers };
  }
  return { kind: "next", answers: nextAnswers, question: questions[nextAnswers.length] };
}
```

- [ ] **Step 4: Re-export from the shared barrel** — add to `packages/shared/src/index.ts`

```ts
export * from "./dmEngine";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @poddaily/shared exec vitest run src/dmEngine.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dmEngine.ts packages/shared/src/dmEngine.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): advanceReport pure DM Q&A reducer (skip / skip-all / complete)"
```

---

### Task 2: Scaffold `apps/api` service package

A new Bolt service. Mirrors `apps/worker`'s package shape (ESM, `tsx`, workspace deps).

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@poddaily/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@poddaily/db": "workspace:*",
    "@poddaily/shared": "workspace:*",
    "@poddaily/slack-client": "workspace:*",
    "@slack/bolt": "^4.2.0"
  },
  "devDependencies": {
    "@poddaily/slack-stub": "workspace:*",
    "bullmq": "^5.34.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`** (copy the worker's compiler options verbatim)

Run: `cat apps/worker/tsconfig.json` and reproduce it as `apps/api/tsconfig.json` unchanged
(same monorepo base, same module/target settings). Do not invent new options.

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: `@poddaily/api` resolves workspace deps; `@slack/bolt` added to the lockfile.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json pnpm-lock.yaml
git commit -m "chore(api): scaffold @poddaily/api service package (bolt)"
```

---

### Task 3: `handleMessage` orchestrator (integration TDD)

Dependency-injected (`{ db, slack }`) so it is tested against real Postgres + the stub
recorder, exactly like `sendDm`. This is the inbound counterpart to `sendDm`.

**Files:**
- Create: `apps/api/src/handleMessage.ts`
- Test: `apps/api/src/handleMessage.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/api/src/handleMessage.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleMessage } from "./handleMessage";

const { db, sql } = createDb();
const CHAN = "C_HM_TEST";
const USER = "U_HM_TEST";
const DM = "D_HM_TEST";

/** In-memory SlackClient that records posts; openDm is unused on the inbound path. */
function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    async openDm() { return DM; },
    async postMessage(channel: string, text: string) { posts.push({ channel, text }); return "ts1"; },
  };
}

let runId: string;

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('HM Pod', ${CHAN}, 'hm') returning id`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, outro_message, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([
              { id: "q1", text: "What did you do?", type: "text" },
              { id: "q2", text: "What will you do?", type: "text" },
            ])},
            '0 10 * * 1', 'UTC', 'Thanks!', true) returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'open') returning id`;
  runId = run.id;
});

beforeEach(async () => {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HM Tester', ${sql.json([])}, 'in_progress')`;
});

afterAll(async () => { await cleanup(); await sql.end(); });

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}

describe("handleMessage", () => {
  it("records an answer and posts the next question", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Did stuff" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(1);
    expect(r.status).toBe("in_progress");
    expect(slack.posts.at(-1)?.text).toBe("What will you do?");
  });

  it("completes after the last question and posts the outro", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 1" });
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 2" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(2);
    expect(r.status).toBe("completed");
    expect(slack.posts.at(-1)?.text).toBe("Thanks!");
  });

  it("`skip all` aborts the report to timed_out", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "skip all" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    expect(r.answers).toHaveLength(0);
  });

  it("ignores a DM when the user has no open report", async () => {
    await sql`delete from standup_reports where slack_user_id = ${USER}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "hello?" });
    expect(slack.posts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @poddaily/api exec vitest run src/handleMessage.test.ts`
Expected: FAIL — "Cannot find module './handleMessage'".
(Requires local Postgres + a migrated DB, same as every other integration test in the repo.)

- [ ] **Step 3: Write the implementation** — `apps/api/src/handleMessage.ts`

```ts
import { schema, eq, and, desc } from "@poddaily/db";
import { advanceReport } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleMessageDeps {
  db: Db;
  slack: SlackClient;
}

/** One inbound DM reply from a member. */
export interface IncomingDm {
  slackUserId: string;
  channel: string; // the DM channel id to reply into
  text: string;
}

const DEFAULT_OUTRO = "Thanks — your standup is in. ✅";
const ABORT_REPLY = "No problem — skipping today's standup. 👋";

/**
 * Reconstruct progress from the user's open report, advance it via the pure reducer,
 * persist, and post the next message. Stateless: no conversation store. Channel
 * broadcast on completion is Step 6 — here we only post the outro into the DM.
 */
export async function handleMessage(deps: HandleMessageDeps, msg: IncomingDm): Promise<void> {
  const { db, slack } = deps;

  // The user's currently-open report is the conversation they're answering (Phase 1:
  // one standup per team, so the most-recent in_progress row is unambiguous).
  const [report] = await db
    .select()
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.slackUserId, msg.slackUserId),
      eq(schema.standupReports.status, "in_progress"),
    ))
    .orderBy(desc(schema.standupReports.createdAt))
    .limit(1);
  if (!report) return; // no open report — ignore stray DM

  const [run] = await db.select().from(schema.standupRuns).where(eq(schema.standupRuns.id, report.runId));
  if (!run) return;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, run.standupId));
  if (!standup) return;

  const action = advanceReport({ questions: standup.questions, answers: report.answers, message: msg.text });

  switch (action.kind) {
    case "noop":
      return;

    case "abort":
      await db.update(schema.standupReports)
        .set({ status: "timed_out" })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, ABORT_REPLY);
      return;

    case "next":
      await db.update(schema.standupReports)
        .set({ answers: action.answers })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, action.question.text);
      return;

    case "complete":
      await db.update(schema.standupReports)
        .set({ answers: action.answers, status: "completed", reportedAt: new Date() })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, standup.outroMessage ?? DEFAULT_OUTRO);
      return; // broadcast → Step 6
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @poddaily/api exec vitest run src/handleMessage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handleMessage.ts apps/api/src/handleMessage.test.ts
git commit -m "feat(api): handleMessage inbound DM orchestrator over stateless reducer"
```

---

### Task 4: Bolt app wiring (`message.im` → handleMessage)

Thin transport layer. Bolt verifies the Slack signing secret on the HTTP receiver; the
handler filters to real user DMs and delegates to the tested `handleMessage`.

**Files:**
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Write `apps/api/src/index.ts`**

```ts
import bolt from "@slack/bolt";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { handleMessage } from "./handleMessage";

const { App } = bolt;

const { db } = createDb();
const slack = createSlackClient();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// message.im — a user's DM reply. Ignore edits/joins/bot echoes (any subtype) and
// non-DM channels. The reducer is idempotent, so a redelivery is harmless.
app.message(async ({ message }) => {
  const m = message as { subtype?: string; channel_type?: string; user?: string; channel: string; text?: string };
  if (m.subtype !== undefined || m.channel_type !== "im" || !m.user || !m.text) return;
  await handleMessage({ db, slack }, { slackUserId: m.user, channel: m.channel, text: m.text });
});

const port = Number(process.env.PORT ?? 3001);
await app.start(port);
console.log(`[api] bolt listening on :${port} (POST /slack/events)`);
```

- [ ] **Step 2: Type-check the service**

Run: `pnpm --filter @poddaily/api exec tsc --noEmit`
Expected: PASS (no type errors). The single `as` cast on Bolt's union message type is
intentional — see scope note 4.

- [ ] **Step 3: Boot smoke (manual sanity, no Slack needed)**

Run: `SLACK_SIGNING_SECRET=test SLACK_BOT_TOKEN=xoxb-test PORT=3001 pnpm --filter @poddaily/api start`
Expected: logs `[api] bolt listening on :3001 (POST /slack/events)`, then Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): bolt message.im receiver wired to handleMessage"
```

---

### Task 5: `smoke:standup` — outbound + inbound end-to-end

The keystone smoke. Boots the **real worker** (BullMQ + Redis + stub) to send the outbound
DM, then drives the **inbound** engine through a full Q&A to completion, asserting both the
recorded Slack messages and the final DB state. Reuses the `standup-outbound-smoke` harness.

**Files:**
- Create: `apps/api/tests/standup-smoke.test.ts`
- Modify: `package.json` (root) — add `smoke:standup` script

- [ ] **Step 1: Write the smoke test** — `apps/api/tests/standup-smoke.test.ts`

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
const QUEUE_NAME = "standup-smoke-5b";
const { db, sql } = createDb();
const CHAN = "C_SMOKE_STANDUP";
const USER = "U_SMOKE_STANDUP";
const DM = "D_SMOKE_STANDUP";
const CRON = cronFromWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 0, minute: 0 }); // immediate

let stub: SlackStub;
let queue: Queue;
let worker: Worker;

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
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await stub.close();
  await cleanup();
  await sql.end();
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
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("smoke:standup", () => {
  it("outbound DM → member answers all questions → completed + outro", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Standup Pod', ${CHAN}, 'standup') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'Standup Tester', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, outro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${JSON.stringify([
                { id: "q1", text: "What did you do?", type: "text" },
                { id: "q2", text: "What will you do?", type: "text" },
              ])},
              ${CRON}, 'UTC', 'Morning!', 'See you tomorrow!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });

    // --- outbound: worker opens the run and DMs intro + Q1 ---
    await enqueueOpenRun(queue, s.id);
    await waitFor(
      async () => (await (await fetch(`${stub.url}/__stub/messages`)).json()) as unknown[],
      (l) => l.length >= 2, // "Morning!" + Q1
    );
    const inProgress = await sql`select * from standup_reports where slack_user_id = ${USER} and status = 'in_progress'`;
    expect(inProgress).toHaveLength(1);

    // --- inbound: member answers both questions via the engine ---
    const slack = createSlackClient();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Shipped the scheduler" });
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Build the inbound engine" });

    // --- assert final state ---
    const [report] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(report.status).toBe("completed");
    expect(report.answers).toHaveLength(2);
    expect(report.answers[1].answer).toBe("Build the inbound engine");

    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ text: string }>;
    const texts = msgs.map((m) => m.text);
    expect(texts).toContain("What will you do?"); // Q2 posted on first reply
    expect(texts).toContain("See you tomorrow!"); // outro on completion
  });
});
```

- [ ] **Step 2: Add the root script** — in `package.json`, append to `"scripts"`:

```json
    "smoke:standup": "vitest run apps/api/tests/standup-smoke.test.ts packages/shared/src/dmEngine.test.ts apps/api/src/handleMessage.test.ts"
```

- [ ] **Step 3: Run the smoke** (requires `docker compose up -d redis` + a migrated DB)

Run: `pnpm smoke:standup`
Expected: PASS — `smoke:standup` 1 test, `dmEngine` 7 tests, `handleMessage` 4 tests.

- [ ] **Step 4: Run the full suite** (no regression in the existing 56 tests)

Run: `pnpm test`
Expected: PASS — all files green, now including `dmEngine`, `handleMessage`, and `smoke:standup`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/standup-smoke.test.ts package.json
git commit -m "test(api): smoke:standup end-to-end outbound DM → full Q&A → completed"
```

---

### Task 6: Dockerfiles + Dokploy compose for api / worker / Redis

The deferred Step 5a deploy. Brings `apps/api`, `apps/worker`, and Redis into the production
compose. See [deployment-dokploy.md](../02_architecture/deployment-dokploy.md#step-5-api-worker-redis).

**Files:**
- Create: `Dockerfile.api`
- Create: `Dockerfile.worker`
- Modify: `docker-compose.dokploy.yml` (uncomment/add `api`, `worker`, `redis` services)

- [ ] **Step 1: Read the existing web Dockerfile + dokploy compose** to copy conventions

Run: `cat Dockerfile docker-compose.dokploy.yml` (match the base image, pnpm version, and
build steps already used for `web`; do not introduce a different Node base or package manager).

- [ ] **Step 2: Create `Dockerfile.worker`** — pnpm workspace install + run the worker entry

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @poddaily/worker...
CMD ["pnpm", "--filter", "@poddaily/worker", "start"]
```

- [ ] **Step 3: Create `Dockerfile.api`** — same shape, api entry, expose the Bolt port

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @poddaily/api...
EXPOSE 3001
CMD ["pnpm", "--filter", "@poddaily/api", "start"]
```

> If the existing `Dockerfile` (web) uses a multi-stage build or a different base/pnpm pin,
> match that instead — these two files must be consistent with it.

- [ ] **Step 4: Add the services to `docker-compose.dokploy.yml`**

Per [deployment-dokploy.md](../02_architecture/deployment-dokploy.md) §(Step 5): add `redis`
(`redis:7-alpine`, persisted volume), `worker` (build `Dockerfile.worker`, no domain), and
`api` (build `Dockerfile.api`, domain mapped, port 3001). All three share `DATABASE_URL`,
`INTERNAL_API_SECRET`, and `SLACK_*`; set `REDIS_URL=redis://redis:6379` for api + worker.

```yaml
  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]
  worker:
    build: { context: ., dockerfile: Dockerfile.worker }
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      INTERNAL_API_SECRET: ${INTERNAL_API_SECRET}
    depends_on: [redis]
  api:
    build: { context: ., dockerfile: Dockerfile.api }
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
      INTERNAL_API_SECRET: ${INTERNAL_API_SECRET}
    ports: ["3001:3001"]
    depends_on: [redis]
# add `redisdata:` under the top-level `volumes:` key
```

- [ ] **Step 5: Validate compose locally**

Run: `docker compose -f docker-compose.dokploy.yml config`
Expected: prints the merged config with no errors (validates YAML + interpolation).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.api Dockerfile.worker docker-compose.dokploy.yml
git commit -m "build(deploy): Dockerfiles + dokploy compose for api, worker, redis"
```

---

### Task 7: Definition-of-done — docs, README, live runbook

A phase is done only when the smoke is green in CI, the **live runbook is walked once**, the
**README is updated**, and the **ContextDB docs + getting-started runbook** are current
([DoD](../02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)).

**Files:**
- Modify: `README.md` (feature checklist + any new env/setup)
- Modify: `ContextDB/00_index/getting-started.md` (run api + worker locally)
- Modify: `ContextDB/02_architecture/slack-integration.md` (mark DM engine implemented)
- Create: `ContextDB/08_logs/2026-06-19-step5b-inbound-dm-qa.md` (build log)

- [ ] **Step 1: Tick the README feature checklist** — change line 23 from `[ ]` to `[x]`:

```markdown
- [x] Conversational DM Q&A (one question at a time, skip / skip all)
```

Add `SLACK_SIGNING_SECRET` and the api service (`PORT`, default 3001) to the README's
environment/configuration section, and note `pnpm --filter @poddaily/api dev` for local run.

- [ ] **Step 2: Update `getting-started.md`** — add running the api alongside the worker
(`pnpm --filter @poddaily/api dev`), the `SLACK_SIGNING_SECRET` requirement, and the Slack app
Event Subscriptions request URL (`https://<api-domain>/slack/events`, `message.im` scope).

- [ ] **Step 3: Mark the DM Q&A engine implemented** in `slack-integration.md` (note skip/skip-all
shipped in 5b; 4h timeout sweep + broadcast still pending in Steps 7 / 6).

- [ ] **Step 4: Write the build log** — `ContextDB/08_logs/2026-06-19-step5b-inbound-dm-qa.md`
summarizing what shipped (advanceReport, apps/api, handleMessage, smoke:standup, deploy),
verification output, and any decisions/fixes discovered during the build.

- [ ] **Step 5: Walk the live runbook once** against the real Slack dev workspace: deploy the
stack to Dokploy, set the Event Subscriptions request URL to the api domain, trigger a run for
yourself, answer the DM end-to-end, confirm `standup_reports` shows `completed`. Record the
result in the build log.

- [ ] **Step 6: Final full verification**

Run: `pnpm test && pnpm smoke:standup`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add README.md ContextDB/00_index/getting-started.md ContextDB/02_architecture/slack-integration.md ContextDB/08_logs/2026-06-19-step5b-inbound-dm-qa.md
git commit -m "docs: Step 5b — inbound DM Q&A engine (README, runbook, context, log)"
```

---

## Self-Review

**Spec coverage** (§5 DM flow, §7 API surface, slack-integration §DM Q&A engine):
- "on each reply, reconstruct state from `standup_reports.answers`, persist, post next question" → Task 1 (reducer) + Task 3 (persist/post). ✓
- "after the last question, mark `completed`, post outro" → Task 3 `complete` branch. ✓
- "`skip` records an empty/(skipped) answer and advances; `skip all` marks aborted and ends" → Task 1 + Task 3. ✓
- "idempotent — redelivered event maps to same index" → Task 1 `noop` + reducer purity. ✓
- "`message.im` via Bolt, signing-secret verification" → Task 4. ✓
- Production deploy of worker + Redis (deferred from 5a) → Tasks 6–7. ✓
- **Deliberately deferred** (documented in scope notes): channel broadcast → Step 6; 4h timeout sweeper → Step 7; reporter user-OAuth → Step 6.

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows complete code; Tasks 2/6 reference existing files to copy verbatim rather than inventing config. ✓

**Type consistency:** `DmAdvance` kinds (`next` | `complete` | `abort` | `noop`) are produced in Task 1 and consumed by the identical `switch` in Task 3. `handleMessage(deps, msg)` / `HandleMessageDeps` / `IncomingDm` are defined in Task 3 and used unchanged in Tasks 4–5. `advanceReport({ questions, answers, message })` signature matches across Tasks 1, 3, 5. ✓

> **Two-subsystem note:** Tasks 1–5 (the inbound engine) and Tasks 6–7 (production deploy) are
> independent. The Step 5a log bundled them, so they live in one plan, but Tasks 6–7 can be
> split into a "Step 5c — deploy" plan if you'd rather ship the engine to CI first and deploy
> separately. Tasks 1–5 produce working, CI-verifiable software on their own.
