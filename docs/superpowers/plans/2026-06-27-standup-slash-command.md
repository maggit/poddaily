# `/standup` Slash Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a discoverable `/standup` Slack slash command with `start` / `status` / `help` subcommands, reusing the existing retrigger machinery to start a standup on demand.

**Architecture:** A new `getMemberDayState` query helper classifies the invoker's standup state for today (`not_member` / `no_standup` / `completed` / `in_progress` / `pending`). A new `handleCommand` orchestrator parses the subcommand and returns an ephemeral reply, enqueueing the existing retrigger job for the `pending` start case. The Bolt `app.command("/standup")` handler in the api wires it up; the existing DM-keyword path (`maybeRetrigger`) is refactored to share the same state helper so the two front doors can't drift.

**Tech Stack:** Slack Bolt (HTTP mode), BullMQ, Drizzle ORM + postgres-js, Vitest, TypeScript, pnpm workspaces.

## Global Constraints

- The api app is `apps/api`; Slack handlers register on the Bolt `App` in `apps/api/src/index.ts`. Commands and `message.im` events share the one `/slack/events` endpoint; signing-secret verification is already configured.
- `RetriggerJob` (from `@poddaily/shared`) is `{ standupId: string; slackUserId: string; slackDisplayName: string; channel: string }` — `channel` is **required** (worker ignores it; carried for completeness). The slash path passes `command.channel_id`.
- "Today" is `anchorDate(standup.scheduleTz, new Date())` (ISO date string) — import `anchorDate` from `@poddaily/shared`, matching `maybeRetrigger`.
- Drizzle operators (`eq`, `and`, `desc`) and `schema` import from `@poddaily/db`; the api builds the db via `createDb()`.
- api tests hit a real Postgres: `const { db, sql } = createDb();`, set up rows with raw `sql\`...\``, clean them up, and `await sql.end()` is NOT called per-file here (the api test files share the pattern in `apps/api/src/handleMessage.test.ts` — follow that file's exact lifecycle: `beforeAll` cleanup+insert, `beforeEach` reset, `afterAll` cleanup). vitest defaults `DATABASE_URL` to local Supabase.
- All slash replies are **ephemeral** — returned as a string and sent via Bolt `await ack(reply)`.
- Reply copy is fixed (use these exact strings):
  - Not set up: `You're not set up for standups yet — ask an admin to add you to a team.`
  - Already reported (start): `You've already reported today ✅ — run \`/standup status\` to review.`
  - In progress (start): `You've got a standup in progress — check your DMs to finish. ⏳`
  - Starting: `📋 Starting your standup — check your DMs.`
  - Status completed: `✅ You reported today.`
  - Status in progress: `⏳ In progress — {answered} of {total} answered. Check your DMs to finish.`
  - Status pending: `You haven't reported today yet — run \`/standup\` to start.`
  - Help (multiline):
    ```
    *poddaily standup commands*
    • `/standup` or `/standup start` — start your standup now
    • `/standup status` — check whether you've reported today
    • `/standup help` — show this message
    ```

---

### Task 1: `getMemberDayState` — shared state classifier

**Files:**
- Create: `apps/api/src/standupState.ts`
- Test: `apps/api/src/standupState.test.ts`

**Interfaces:**
- Consumes: `schema`, `eq`, `and` from `@poddaily/db`; `anchorDate` from `@poddaily/shared`; `createDb` db type.
- Produces:
  - `type MemberDayStateKind = "not_member" | "no_standup" | "completed" | "in_progress" | "pending"`
  - `interface MemberDayState { kind: MemberDayStateKind; member?: { teamId: string; slackDisplayName: string }; standup?: { id: string; scheduleTz: string }; answered: number; total: number }`
  - `getMemberDayState(db: Db, slackUserId: string, now?: Date): Promise<MemberDayState>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/standupState.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { getMemberDayState } from "./standupState";

const { db, sql } = createDb();
const CHAN = "C_SDS_TEST";
const USER = "U_SDS_TEST";          // member with a standup
const LONELY = "U_SDS_LONELY";      // member whose team has no standup
const STRANGER = "U_SDS_STRANGER";  // not a member at all
const CHAN2 = "C_SDS_NOSTANDUP";

let standupId: string;
let runId: string;

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id in (${CHAN}, ${CHAN2})))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id in (${CHAN}, ${CHAN2}))`;
  await sql`delete from team_members where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN}, ${CHAN2})`;
}

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SDS Pod', ${CHAN}, 'sds') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'SDS Tester', 'UTC', true)`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])},
            '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;

  const [team2] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('No Standup Pod', ${CHAN2}, 'nost') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team2.id}, ${LONELY}, 'Lonely', 'UTC', true)`;
});

beforeEach(async () => {
  await sql`delete from standup_reports where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe("getMemberDayState", () => {
  it("returns not_member for a user with no team_members row", async () => {
    const st = await getMemberDayState(db, STRANGER);
    expect(st.kind).toBe("not_member");
  });

  it("returns no_standup for a member whose team has no standup", async () => {
    const st = await getMemberDayState(db, LONELY);
    expect(st.kind).toBe("no_standup");
    expect(st.member?.slackDisplayName).toBe("Lonely");
  });

  it("returns pending when there is a run today but no report", async () => {
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("pending");
    expect(st.standup?.id).toBe(standupId);
    expect(st.total).toBe(2);
  });

  it("returns in_progress with answered/total when a report is in progress", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "did" }])}, 'in_progress')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("in_progress");
    expect(st.answered).toBe(1);
    expect(st.total).toBe(2);
  });

  it("returns completed when today's report is completed", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([])}, 'completed')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("completed");
  });

  it("returns pending when a prior report timed out", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([])}, 'timed_out')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("pending");
  });
});
```

- [ ] **Step 2: Run the test (verify it fails)**

Run: `pnpm vitest run apps/api/src/standupState.test.ts`
Expected: FAIL — `./standupState` does not exist.

- [ ] **Step 3: Implement `standupState.ts`**

Create `apps/api/src/standupState.ts`:

```typescript
import { schema, eq, and } from "@poddaily/db";
import { anchorDate } from "@poddaily/shared";
import type { Question, ReportAnswer } from "@poddaily/shared";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export type MemberDayStateKind =
  | "not_member" | "no_standup" | "completed" | "in_progress" | "pending";

export interface MemberDayState {
  kind: MemberDayStateKind;
  member?: { teamId: string; slackDisplayName: string };
  standup?: { id: string; scheduleTz: string };
  answered: number;
  total: number;
}

/**
 * Classify a member's standup state for "today" (the run's tz-anchored date). Shared by the
 * /standup slash command and the DM-keyword retrigger so both front doors agree.
 */
export async function getMemberDayState(
  db: Db,
  slackUserId: string,
  now: Date = new Date(),
): Promise<MemberDayState> {
  const [member] = await db
    .select({ teamId: schema.teamMembers.teamId, slackDisplayName: schema.teamMembers.slackDisplayName })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.slackUserId, slackUserId))
    .limit(1);
  if (!member?.teamId) return { kind: "not_member", answered: 0, total: 0 };

  const [standup] = await db
    .select({ id: schema.standups.id, scheduleTz: schema.standups.scheduleTz, questions: schema.standups.questions })
    .from(schema.standups)
    .where(eq(schema.standups.teamId, member.teamId));
  if (!standup) {
    return { kind: "no_standup", member: { teamId: member.teamId, slackDisplayName: member.slackDisplayName }, answered: 0, total: 0 };
  }

  const total = (standup.questions as Question[]).length;
  const base = {
    member: { teamId: member.teamId, slackDisplayName: member.slackDisplayName },
    standup: { id: standup.id, scheduleTz: standup.scheduleTz },
    total,
  };

  const todayDate = anchorDate(standup.scheduleTz, now);
  const [todayRun] = await db
    .select({ id: schema.standupRuns.id })
    .from(schema.standupRuns)
    .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, todayDate)));
  if (!todayRun) return { ...base, kind: "pending", answered: 0 };

  const [report] = await db
    .select({ status: schema.standupReports.status, answers: schema.standupReports.answers })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, todayRun.id), eq(schema.standupReports.slackUserId, slackUserId)));

  if (report?.status === "completed") return { ...base, kind: "completed", answered: total };
  if (report?.status === "in_progress") {
    return { ...base, kind: "in_progress", answered: (report.answers as ReportAnswer[]).length };
  }
  return { ...base, kind: "pending", answered: 0 };
}
```

- [ ] **Step 4: Run the test (verify it passes)**

Run: `pnpm vitest run apps/api/src/standupState.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/standupState.ts apps/api/src/standupState.test.ts
git commit -m "feat(standup-cmd): getMemberDayState classifier"
```

---

### Task 2: `handleCommand` — parse, classify, reply

**Files:**
- Create: `apps/api/src/handleCommand.ts`
- Test: `apps/api/src/handleCommand.test.ts`

**Interfaces:**
- Consumes: `getMemberDayState`, `MemberDayState` from `./standupState`; `RetriggerJob` from `@poddaily/shared`; db type.
- Produces:
  - `parseSubcommand(text: string): "start" | "status" | "help"`
  - `formatStatus(state: MemberDayState): string`
  - `formatHelp(): string`
  - `interface HandleCommandDeps { db: Db; enqueueRetrigger: (job: RetriggerJob) => Promise<void> }`
  - `interface SlashCommand { slackUserId: string; text: string; channel: string }`
  - `handleCommand(deps: HandleCommandDeps, cmd: SlashCommand): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/handleCommand.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleCommand, parseSubcommand, formatStatus, formatHelp } from "./handleCommand";
import type { MemberDayState } from "./standupState";
import type { RetriggerJob } from "@poddaily/shared";

const { db, sql } = createDb();
const CHAN = "C_HC_TEST";
const USER = "U_HC_TEST";
const DM = "D_HC_TEST";
let standupId: string;
let runId: string;

function recorder() {
  const jobs: RetriggerJob[] = [];
  return { jobs, enqueueRetrigger: async (j: RetriggerJob) => { jobs.push(j); } };
}
const state = (kind: MemberDayState["kind"], answered = 0, total = 2): MemberDayState =>
  ({ kind, answered, total, member: { teamId: "t", slackDisplayName: "X" }, standup: { id: "s", scheduleTz: "UTC" } });

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('HC Pod', ${CHAN}, 'hc') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'HC Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;
});
beforeEach(async () => { await sql`delete from standup_reports where slack_user_id = ${USER}`; });
afterAll(async () => { await cleanup(); await sql.end(); });

describe("parseSubcommand", () => {
  it("maps empty and 'start' to start, 'status' to status, everything else to help", () => {
    expect(parseSubcommand("")).toBe("start");
    expect(parseSubcommand("  ")).toBe("start");
    expect(parseSubcommand("start")).toBe("start");
    expect(parseSubcommand("STATUS")).toBe("status");
    expect(parseSubcommand(" status ")).toBe("status");
    expect(parseSubcommand("help")).toBe("help");
    expect(parseSubcommand("wat")).toBe("help");
  });
});

describe("formatStatus / formatHelp (pure)", () => {
  it("formats each state", () => {
    expect(formatStatus(state("completed"))).toContain("reported today");
    expect(formatStatus(state("in_progress", 1, 2))).toContain("1 of 2");
    expect(formatStatus(state("pending"))).toContain("haven't reported today");
    expect(formatStatus(state("not_member"))).toContain("not set up");
    expect(formatStatus(state("no_standup"))).toContain("not set up");
  });
  it("help lists all three commands", () => {
    const h = formatHelp();
    expect(h).toContain("/standup status");
    expect(h).toContain("/standup help");
    expect(h).toContain("start your standup");
  });
});

describe("handleCommand", () => {
  const cmd = (text: string) => ({ slackUserId: USER, text, channel: DM });

  it("help returns the command list and does not enqueue", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("help"));
    expect(reply).toContain("/standup status");
    expect(r.jobs).toHaveLength(0);
  });

  it("start with a pending state enqueues a retrigger and says starting", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd(""));
    expect(reply).toContain("Starting your standup");
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ standupId, slackUserId: USER, slackDisplayName: "HC Tester", channel: DM });
  });

  it("start when already completed blocks and does not enqueue", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([])}, 'completed')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("start"));
    expect(reply).toContain("already reported today");
    expect(r.jobs).toHaveLength(0);
  });

  it("start when in progress tells them to check DMs and does not enqueue", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "x" }])}, 'in_progress')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("start"));
    expect(reply).toContain("in progress");
    expect(r.jobs).toHaveLength(0);
  });

  it("status reflects an in-progress report", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "x" }])}, 'in_progress')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("status"));
    expect(reply).toContain("1 of 2");
  });

  it("unknown subcommand falls back to help", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("frobnicate"));
    expect(reply).toContain("/standup help");
    expect(r.jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (verify it fails)**

Run: `pnpm vitest run apps/api/src/handleCommand.test.ts`
Expected: FAIL — `./handleCommand` does not exist.

- [ ] **Step 3: Implement `handleCommand.ts`**

Create `apps/api/src/handleCommand.ts`:

```typescript
import type { RetriggerJob } from "@poddaily/shared";
import type { createDb } from "@poddaily/db";
import { getMemberDayState, type MemberDayState } from "./standupState";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleCommandDeps {
  db: Db;
  enqueueRetrigger: (job: RetriggerJob) => Promise<void>;
}

export interface SlashCommand {
  slackUserId: string;
  text: string;
  channel: string; // command.channel_id — carried into the retrigger job
}

const NOT_SET_UP = "You're not set up for standups yet — ask an admin to add you to a team.";
const ALREADY_REPORTED = "You've already reported today ✅ — run `/standup status` to review.";
const IN_PROGRESS_START = "You've got a standup in progress — check your DMs to finish. ⏳";
const STARTING = "📋 Starting your standup — check your DMs.";

const HELP = [
  "*poddaily standup commands*",
  "• `/standup` or `/standup start` — start your standup now",
  "• `/standup status` — check whether you've reported today",
  "• `/standup help` — show this message",
].join("\n");

export function parseSubcommand(text: string): "start" | "status" | "help" {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "start") return "start";
  if (t === "status") return "status";
  return "help";
}

export function formatHelp(): string {
  return HELP;
}

export function formatStatus(state: MemberDayState): string {
  switch (state.kind) {
    case "not_member":
    case "no_standup":
      return NOT_SET_UP;
    case "completed":
      return "✅ You reported today.";
    case "in_progress":
      return `⏳ In progress — ${state.answered} of ${state.total} answered. Check your DMs to finish.`;
    case "pending":
      return "You haven't reported today yet — run `/standup` to start.";
  }
}

export async function handleCommand(deps: HandleCommandDeps, cmd: SlashCommand): Promise<string> {
  const sub = parseSubcommand(cmd.text);
  if (sub === "help") return formatHelp();

  const state = await getMemberDayState(deps.db, cmd.slackUserId);
  if (sub === "status") return formatStatus(state);

  // sub === "start"
  switch (state.kind) {
    case "not_member":
    case "no_standup":
      return NOT_SET_UP;
    case "completed":
      return ALREADY_REPORTED;
    case "in_progress":
      return IN_PROGRESS_START;
    case "pending":
      await deps.enqueueRetrigger({
        standupId: state.standup!.id,
        slackUserId: cmd.slackUserId,
        slackDisplayName: state.member!.slackDisplayName,
        channel: cmd.channel,
      });
      return STARTING;
  }
}
```

- [ ] **Step 4: Run the test (verify it passes)**

Run: `pnpm vitest run apps/api/src/handleCommand.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handleCommand.ts apps/api/src/handleCommand.test.ts
git commit -m "feat(standup-cmd): handleCommand parse/classify/reply"
```

---

### Task 3: Refactor `maybeRetrigger` onto the shared classifier (DRY)

**Files:**
- Modify: `apps/api/src/handleMessage.ts:208-255`
- Test: `apps/api/src/handleMessage.test.ts` (existing — must stay green; do not weaken)

**Interfaces:**
- Consumes: `getMemberDayState` from `./standupState`.

> The DM-keyword path must keep its exact current behavior and its two distinct "not set up" messages. Only the internal state lookup changes; the keyword set, the completed-block, the enqueue, and the reply strings are unchanged.

- [ ] **Step 1: Replace the body of `maybeRetrigger`**

In `apps/api/src/handleMessage.ts`, add to the imports at the top of the file:

```typescript
import { getMemberDayState } from "./standupState";
```

Replace the entire `maybeRetrigger` function (lines 214–255, the function body — keep `RETRIGGER_KEYWORDS` above it) with:

```typescript
async function maybeRetrigger(deps: HandleMessageDeps, msg: IncomingDm): Promise<void> {
  const { slack, enqueueRetrigger } = deps;
  if (!RETRIGGER_KEYWORDS.has(msg.text.trim().toLowerCase())) return;

  const state = await getMemberDayState(deps.db, msg.slackUserId);
  if (state.kind === "not_member") {
    await slack.postMessage(msg.channel, "You're not set up for a standup yet.");
    return;
  }
  if (state.kind === "no_standup") {
    await slack.postMessage(msg.channel, "Your team has no standup configured yet.");
    return;
  }
  if (state.kind === "completed") {
    await slack.postMessage(msg.channel, "You've already reported today ✅");
    return;
  }

  // in_progress or pending → (re)start. The worker retrigger() leaves an in_progress report
  // untouched and re-opens absent/timed_out ones; this matches the prior behavior (enqueue
  // unless already completed).
  await enqueueRetrigger({
    standupId: state.standup!.id,
    slackUserId: msg.slackUserId,
    slackDisplayName: state.member!.slackDisplayName,
    channel: msg.channel,
  });
  await slack.postMessage(msg.channel, "📋 Restarting your standup…");
}
```

- [ ] **Step 2: Run the existing retrigger tests (verify still green)**

Run: `pnpm vitest run apps/api/src/handleMessage.test.ts`
Expected: PASS — all existing tests, including the retrigger-enqueue and already-completed-block cases, still pass unchanged.

- [ ] **Step 3: Typecheck the api app**

Run: `pnpm --filter @poddaily/api exec tsc --noEmit`
Expected: no errors. (If the api package has no `typecheck` script, this is the direct command; the api `tsconfig.json` is at `apps/api/tsconfig.json`.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/handleMessage.ts
git commit -m "refactor(api): maybeRetrigger uses getMemberDayState (shared with /standup)"
```

---

### Task 4: Wire the Bolt command + manifest + smoke

**Files:**
- Modify: `apps/api/src/index.ts:24-28`
- Modify: `app_manifest.yaml`
- Create: `apps/api/tests/standup-command-smoke.test.ts`
- Modify: `package.json` (root — add `smoke:standup-cmd`)

**Interfaces:**
- Consumes: `handleCommand` from `./handleCommand`.

- [ ] **Step 1: Register the slash command in the Bolt app**

In `apps/api/src/index.ts`, add the import alongside the existing `handleMessage` import:

```typescript
import { handleCommand } from "./handleCommand";
```

Immediately after the existing `app.message(...)` block (after line 28), add:

```typescript
// /standup [start|status|help] — discoverable on-demand standup control. Bolt routes slash
// commands through the same /slack/events endpoint as message.im. ack(reply) → ephemeral.
app.command("/standup", async ({ ack, command }) => {
  const reply = await handleCommand(
    { db, enqueueRetrigger },
    { slackUserId: command.user_id, text: command.text, channel: command.channel_id },
  );
  await ack(reply);
});
```

- [ ] **Step 2: Add the slash command to the manifest**

In `app_manifest.yaml`, under the top-level `settings:` key (sibling of `event_subscriptions:`), add:

```yaml
  slash_commands:
    - command: /standup
      url: https://poddaily.example.com/api/slack/events
      description: Start your standup, or check your status
      usage_hint: "[status|help]"
      should_escape: false
```

(Match the existing indentation of keys under `settings:` — two spaces. Use the same host as the existing `event_subscriptions.request_url`.)

- [ ] **Step 3: Write the smoke test**

Create `apps/api/tests/standup-command-smoke.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleCommand } from "../src/handleCommand";
import type { RetriggerJob } from "@poddaily/shared";

const { db, sql } = createDb();
const CHAN = "C_SCSMK";
const USER = "U_SCSMK";
const DM = "D_SCSMK";
let standupId: string;
let runId: string;

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SC Pod', ${CHAN}, 'sc') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'SC Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;
});
beforeEach(async () => { await sql`delete from standup_reports where slack_user_id = ${USER}`; });
afterAll(async () => { await cleanup(); await sql.end(); });

describe("smoke:standup-cmd", () => {
  it("start → enqueues retrigger; status → pending; after completion → blocked", async () => {
    const jobs: RetriggerJob[] = [];
    const deps = { db, enqueueRetrigger: async (j: RetriggerJob) => { jobs.push(j); } };

    const started = await handleCommand(deps, { slackUserId: USER, text: "", channel: DM });
    expect(started).toContain("Starting your standup");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].standupId).toBe(standupId);

    const status = await handleCommand(deps, { slackUserId: USER, text: "status", channel: DM });
    expect(status).toContain("haven't reported today");

    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'SC Tester', ${JSON.stringify([])}, 'completed')`;
    const blocked = await handleCommand(deps, { slackUserId: USER, text: "start", channel: DM });
    expect(blocked).toContain("already reported today");
    expect(jobs).toHaveLength(1); // no new enqueue
  });
});
```

- [ ] **Step 4: Add the `smoke:standup-cmd` script**

In root `package.json` scripts, add (mirroring the existing `smoke:*` entries):

```json
    "smoke:standup-cmd": "vitest run apps/api/src/standupState.test.ts apps/api/src/handleCommand.test.ts apps/api/tests/standup-command-smoke.test.ts",
```

- [ ] **Step 5: Run the smoke + typecheck**

Run: `pnpm smoke:standup-cmd`
Expected: PASS (all three files).
Run: `pnpm --filter @poddaily/api exec tsc --noEmit`
Expected: no errors (the `app.command` wiring typechecks).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts app_manifest.yaml apps/api/tests/standup-command-smoke.test.ts package.json
git commit -m "feat(standup-cmd): wire /standup Bolt command + manifest + smoke"
```

---

### Task 5: Docs + Definition of Done

**Files:**
- Modify: `README.md`
- Modify: `ContextDB/02_architecture/deployment-dokploy.md`
- Create: `ContextDB/08_logs/2026-06-27-standup-slash-command.md`

- [ ] **Step 1: Update the README**

In `README.md`: tick the `/standup` slash-command item in the Phase 4 / P1 feature list (search for "standup" / "slash"). Add a short usage subsection documenting the three subcommands (`/standup` or `/standup start`, `/standup status`, `/standup help`), that replies are private (ephemeral) and the Q&A happens in the bot DM, and that on-demand start works any day/time. Note the **deploy step**: after deploying, update the Slack app from `app_manifest.yaml` so the `/standup` command registers (the `commands` scope is already granted).

- [ ] **Step 2: Add the slash-command registration note to the runbook**

In `ContextDB/02_architecture/deployment-dokploy.md`, under the Slack app section (Part D) or Production gotchas, add a bullet: registering or changing a slash command requires updating the app from the manifest in the Slack app config (App Manifest → paste/update → Save), and that the request URL is the same `/api/slack/events` endpoint Bolt already serves. No reinstall is needed (the `commands` scope is already granted).

- [ ] **Step 3: Write the build log**

Create `ContextDB/08_logs/2026-06-27-standup-slash-command.md` summarizing: what shipped (`/standup` start/status/help over the retrigger machinery), the shared `getMemberDayState` classifier (and the `maybeRetrigger` refactor onto it), the manifest change, and the verification (`pnpm test` result). Link the spec (`../../docs/superpowers/specs/2026-06-27-standup-slash-command-design.md`) and plan.

- [ ] **Step 4: Full verification**

Run: `pnpm test`
Expected: PASS (web lint + typecheck via `pnpm run check`, then the full vitest suite including the three new `/standup` test files: `standupState.test.ts`, `handleCommand.test.ts`, `standup-command-smoke.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add README.md ContextDB/02_architecture/deployment-dokploy.md ContextDB/08_logs/2026-06-27-standup-slash-command.md
git commit -m "docs(standup-cmd): README + runbook + build log"
```

- [ ] **Step 6: Live smoke (DoD — manual, requires a Slack dev workspace)**

After deploying and updating the Slack app from the manifest: in the dev workspace run `/standup help` (see the command list), `/standup status` (see "haven't reported today"), `/standup` (receive the standup DM), answer it, then `/standup` again (see "already reported"), and `/standup status` (see "reported today"). Record the walk in the build log.

---

## Notes on Definition of Done

Per [CLAUDE.md](../../CLAUDE.md): `smoke:standup-cmd` + full `pnpm test` green in CI; live smoke walked once in a real Slack dev workspace (Task 5 Step 6); README updated with the command usage + the manifest deploy step; ContextDB build log + runbook note added. Tasks 4–5 cover the automated + doc items; Task 5 Step 6 is the manual live walk.
```
