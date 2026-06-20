# Step 6a — Channel Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a member completes their standup DM, broadcast the report to the team's Slack channel — one opening thread message per run (with a live `Reported: n out of total` counter) and one threaded Block Kit reply per completed report, attributed to the member via `chat:write.customize`.

**Architecture:** The **worker** (`openRun`) posts the opening message once when the run opens and stores its ts on `standup_runs.channel_opening_ts` (race-free — the run opens exactly once). The **api** (`handleMessage` complete branch) posts each completed report as a threaded reply under that ts and `chat.update`s the counter. Decision logic for message text lives in pure, TDD'd builders in `@poddaily/shared`; Slack I/O goes through an extended `@poddaily/slack-client`. The broadcast is best-effort and isolated — a channel-post failure logs and is swallowed, never reverting the completed report.

**Tech Stack:** Drizzle (`@poddaily/db`), `@poddaily/shared` (pure builders), `@slack/web-api` via `@poddaily/slack-client`, BullMQ worker, `@slack/bolt` api, Vitest, the `tools/slack-stub` recorder.

Source: [Step 6a design spec](../specs/2026-06-20-step6a-channel-broadcast-design.md) · [slack-integration §Channel broadcast](../../../ContextDB/02_architecture/slack-integration.md#channel-broadcast) · [PRD message format](../../../ContextDB/01_specs/poddaily-prd.md#slack-message-format) · [post-as-user ADR](../../../ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md).

> **Scope notes (documented, not gaps):**
> 1. **Attribution is `chat:write.customize`** (bot posts with the member's `username` + `icon_url`). True post-as-user authorship (user tokens) is **Step 6b**. 6a's path becomes the permanent fallback.
> 2. **Broadcast is best-effort.** A channel-post failure (network, `not_in_channel`, missing opening ts) logs `[broadcast] degraded …` and is swallowed; the report stays `completed`, `channel_post_ts` stays null. No re-broadcast retry in 6a.
> 3. **Bot must be in the team channel** or `chat.postMessage` returns `not_in_channel` — an operational/runbook requirement, surfaced as a clear log. Auto-join is out of scope.
> 4. **Counter is derived from `standup_reports`:** `total` = reports for the run, `reported` = those `completed`. Recomputed from the DB on each update, so overlapping completions converge.

---

## File Structure

```
packages/db/src/schema.ts                    # + standup_runs.channelOpeningTs
packages/db/migrations/                       # new generated migration (channel_opening_ts)
packages/shared/src/broadcast.ts (+ test)    # buildOpeningMessage, buildReportBlocks (pure)
packages/shared/src/index.ts                 # re-export ./broadcast
tools/slack-stub/src/server.ts (+ test)      # record thread_ts/username/icon_url/blocks; chat.update; /__stub/updates
packages/slack-client/src/index.ts (+ test)  # PostMessageOptions on postMessage; updateMessage
apps/worker/src/types.ts                     # OpenRunDeps gains slack
apps/worker/src/openRun.ts (+ test)          # post opening message + store ts
apps/worker/src/processor.ts                 # pass slack into openRun
apps/api/src/handleMessage.ts (+ test)       # complete branch: threaded reply + counter update
apps/api/tests/standup-smoke.test.ts         # broadcast assertions
README.md · ContextDB/* · build log          # DoD
```

---

### Task 1: Schema — `channel_opening_ts` on `standup_runs`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Generate: a new migration under `packages/db/migrations/`

- [ ] **Step 1: Add the column** — in `packages/db/src/schema.ts`, inside the `standupRuns` table definition, add `channelOpeningTs` after `status` (and before `createdAt`):

```ts
  status: text("status").default("pending"),
  channelOpeningTs: text("channel_opening_ts"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @poddaily/db generate`
Expected: a new file `packages/db/migrations/0002_*.sql` containing
`ALTER TABLE "standup_runs" ADD COLUMN "channel_opening_ts" text;` (plus the snapshot/journal updates).

- [ ] **Step 3: Apply it to the local DB**

Run: `pnpm --filter @poddaily/db migrate`
Expected: applies cleanly (the new column is added; idempotent on re-run).

- [ ] **Step 4: Verify the column exists**

Run: `pnpm --filter @poddaily/db exec tsx -e "import {createDb} from './src'; const {sql}=createDb(); const r=await sql\`select column_name from information_schema.columns where table_name='standup_runs' and column_name='channel_opening_ts'\`; console.log(r); await sql.end();"`
Expected: prints one row `[ { column_name: 'channel_opening_ts' } ]`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): add standup_runs.channel_opening_ts for broadcast threading"
```

---

### Task 2: Pure Block Kit builders in `@poddaily/shared` (TDD)

**Files:**
- Create: `packages/shared/src/broadcast.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/broadcast.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/broadcast.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildOpeningMessage, buildReportBlocks } from "./broadcast";
import type { ReportAnswer } from "./questions";

describe("buildOpeningMessage", () => {
  it("renders the heading + counter as text and a single section block", () => {
    const { text, blocks } = buildOpeningMessage({
      standupName: "Daily Standup", date: "2026-06-20", reported: 1, total: 3,
    });
    expect(text).toContain("📋 *Daily Standup — 2026-06-20*");
    expect(text).toContain("Reported: 1 out of 3");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "section", text: { type: "mrkdwn" } });
  });
});

describe("buildReportBlocks", () => {
  const answers: ReportAnswer[] = [
    { questionId: "q1", questionText: "What did you do?", answer: "Shipped 6a" },
    { questionId: "q2", questionText: "What will you do?", answer: "Tests" },
  ];

  it("renders a header + divider + one section per Q&A", () => {
    const { text, blocks } = buildReportBlocks({
      standupName: "Daily Standup", displayName: "Raquel", answers,
    });
    expect(text).toContain("*Raquel* posted an update for Daily Standup");
    expect(text).toContain("What did you do?");
    expect(text).toContain("Shipped 6a");
    // header section + divider + 2 Q&A sections
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({ type: "section" });
    expect(blocks[1]).toMatchObject({ type: "divider" });
    expect(blocks[2]).toMatchObject({ type: "section", text: { type: "mrkdwn", text: "*What did you do?*\nShipped 6a" } });
    expect(blocks[3]).toMatchObject({ type: "section", text: { type: "mrkdwn", text: "*What will you do?*\nTests" } });
  });

  it("handles a single-question standup", () => {
    const { blocks } = buildReportBlocks({
      standupName: "S", displayName: "X",
      answers: [{ questionId: "q1", questionText: "Q?", answer: "A" }],
    });
    expect(blocks).toHaveLength(3); // header + divider + 1
  });
});
```

- [ ] **Step 2: Run it from the REPO ROOT and confirm it FAILS** (module not found)

Run: `pnpm exec vitest run packages/shared/src/broadcast.test.ts`
Expected: FAIL — "Cannot find module './broadcast'".
(Note: run vitest from the repo root, NOT with `pnpm --filter` — the vitest include glob is repo-root-relative.)

- [ ] **Step 3: Implement** — `packages/shared/src/broadcast.ts`

```ts
import type { ReportAnswer } from "./questions";

/** A built Slack message: a plain-text fallback plus Block Kit blocks. */
export interface BuiltMessage {
  text: string;
  blocks: unknown[];
}

/** The opening thread message for a run, with the live "Reported: n out of total" counter. */
export function buildOpeningMessage(args: {
  standupName: string;
  date: string;
  reported: number;
  total: number;
}): BuiltMessage {
  const { standupName, date, reported, total } = args;
  const text =
    `📋 *${standupName} — ${date}*\n` +
    `Find all reports for *${standupName}, ${date}* in this thread.\n` +
    `Reported: ${reported} out of ${total}`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

/** One member's report: a header section, a divider, then one section per Q&A pair. */
export function buildReportBlocks(args: {
  standupName: string;
  displayName: string;
  answers: ReportAnswer[];
}): BuiltMessage {
  const { standupName, displayName, answers } = args;
  const header = `*${displayName}* posted an update for ${standupName}`;
  const qaLines = answers.map((a) => `*${a.questionText}*\n${a.answer}`);
  const text = [header, ...qaLines].join("\n");
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "divider" },
    ...answers.map((a) => ({ type: "section", text: { type: "mrkdwn", text: `*${a.questionText}*\n${a.answer}` } })),
  ];
  return { text, blocks };
}
```

- [ ] **Step 4: Re-export** — add to `packages/shared/src/index.ts`:

```ts
export * from "./broadcast";
```

- [ ] **Step 5: Run the test, confirm PASS** (3 tests)

Run: `pnpm exec vitest run packages/shared/src/broadcast.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/broadcast.ts packages/shared/src/broadcast.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): pure Block Kit builders for opening message + report"
```

---

### Task 3: Extend the Slack stub (record fields + `chat.update`)

The smoke and slack-client tests need the stub to record `thread_ts`/`username`/`icon_url`/`blocks` and to handle `chat.update`.

**Files:**
- Modify: `tools/slack-stub/src/server.ts`
- Test: `tools/slack-stub/src/server.test.ts` (add cases)

- [ ] **Step 1: Read** `tools/slack-stub/src/server.ts` to confirm the current `messages` recorder, `RecordedMessage`, the `/api/chat.postMessage`, `/__stub/messages`, and `/__stub/reset` handlers.

- [ ] **Step 2: Widen `RecordedMessage` and add an `updates` recorder.** Replace the `RecordedMessage` interface with:

```ts
export interface RecordedMessage {
  channel: string;
  text: string;
  thread_ts?: string;
  username?: string;
  icon_url?: string;
  blocks?: string; // raw JSON string as Slack receives it (form-encoded)
}

export interface RecordedUpdate {
  channel: string;
  ts: string;
  text: string;
}
```

And inside `startSlackStub`, alongside `const messages: RecordedMessage[] = [];`, add:

```ts
  const updates: RecordedUpdate[] = [];
```

- [ ] **Step 3: Record the new fields on `chat.postMessage`.** Replace the existing `/api/chat.postMessage` handler body with:

```ts
    if (u.pathname === "/api/chat.postMessage") {
      const body = await readBody(req);
      messages.push({
        channel: body.get("channel") ?? "",
        text: body.get("text") ?? "",
        thread_ts: body.get("thread_ts") ?? undefined,
        username: body.get("username") ?? undefined,
        icon_url: body.get("icon_url") ?? undefined,
        blocks: body.get("blocks") ?? undefined,
      });
      return json(200, { ok: true, ts: String(tsCounter++) });
    }
```

- [ ] **Step 4: Add a `chat.update` handler** (right after the `chat.postMessage` block):

```ts
    if (u.pathname === "/api/chat.update") {
      const body = await readBody(req);
      updates.push({
        channel: body.get("channel") ?? "",
        ts: body.get("ts") ?? "",
        text: body.get("text") ?? "",
      });
      return json(200, { ok: true, ts: body.get("ts") ?? "" });
    }
```

- [ ] **Step 5: Expose updates + clear both on reset.** Add a `/__stub/updates` introspection route (next to `/__stub/messages`) and clear `updates` in `/__stub/reset`:

```ts
    if (u.pathname === "/__stub/updates") {
      return json(200, updates);
    }
    if (u.pathname === "/__stub/messages") {
      return json(200, messages);
    }
    if (u.pathname === "/__stub/reset") {
      messages.length = 0;
      updates.length = 0;
      return json(200, { ok: true });
    }
```

- [ ] **Step 6: Add a stub test** — append to `tools/slack-stub/src/server.test.ts` a case proving the new recording. Use the existing test's pattern (start the stub on port 0, POST form-encoded bodies, read introspection). Example:

```ts
it("records thread_ts/username/blocks on postMessage and chat.update", async () => {
  const stub = await startSlackStub(0);
  try {
    await fetch(`${stub.url}/api/chat.postMessage`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ channel: "C1", text: "hi", thread_ts: "111.0", username: "Raquel", blocks: "[{}]" }),
    });
    await fetch(`${stub.url}/api/chat.update`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ channel: "C1", ts: "999.0", text: "Reported: 1 out of 1" }),
    });
    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
    expect(msgs[0]).toMatchObject({ channel: "C1", text: "hi", thread_ts: "111.0", username: "Raquel" });
    const updates = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<Record<string, string>>;
    expect(updates[0]).toMatchObject({ channel: "C1", ts: "999.0", text: "Reported: 1 out of 1" });
  } finally {
    await stub.close();
  }
});
```

- [ ] **Step 7: Run the stub tests, confirm PASS**

Run: `pnpm exec vitest run tools/slack-stub/src/server.test.ts`
Expected: PASS (existing cases + the new one).

- [ ] **Step 8: Commit**

```bash
git add tools/slack-stub/src/server.ts tools/slack-stub/src/server.test.ts
git commit -m "test(slack-stub): record thread_ts/username/blocks + chat.update"
```

---

### Task 4: Extend `@poddaily/slack-client` (post options + `updateMessage`)

**Files:**
- Modify: `packages/slack-client/src/index.ts`
- Test: `packages/slack-client/src/index.test.ts` (add cases)

- [ ] **Step 1: Read** `packages/slack-client/src/index.ts` and `packages/slack-client/src/index.test.ts` to confirm the current `SlackClient` interface, `createSlackClient`, and how the existing test points the client at the stub (`baseUrl`/`SLACK_API_BASE_URL`).

- [ ] **Step 2: Write the failing test** — add to `packages/slack-client/src/index.test.ts` (it already starts the stub; reuse that setup). Add cases that exercise the new options and `updateMessage` against the stub introspection:

```ts
it("postMessage forwards thread_ts / username / blocks", async () => {
  const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
  await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
  await client.postMessage("C_CHAN", "fallback", {
    threadTs: "100.5", username: "Raquel", iconUrl: "https://x/a.png", blocks: [{ type: "divider" }],
  });
  const [msg] = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
  expect(msg).toMatchObject({ channel: "C_CHAN", thread_ts: "100.5", username: "Raquel", icon_url: "https://x/a.png" });
});

it("updateMessage calls chat.update", async () => {
  const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
  await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
  await client.updateMessage("C_CHAN", "200.7", { text: "Reported: 2 out of 3" });
  const [upd] = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<Record<string, string>>;
  expect(upd).toMatchObject({ channel: "C_CHAN", ts: "200.7", text: "Reported: 2 out of 3" });
});
```

> If the existing test file does not already hold a module-scoped `stub`, mirror its current setup (it starts `startSlackStub` in `beforeAll`/`afterAll`). Match whatever pattern is there rather than introducing a second stub lifecycle.

- [ ] **Step 3: Run from repo root, confirm the new cases FAIL** (`updateMessage` undefined / options ignored)

Run: `pnpm exec vitest run packages/slack-client/src/index.test.ts`
Expected: FAIL on the two new cases.

- [ ] **Step 4: Implement** — update `packages/slack-client/src/index.ts`:

```ts
import { WebClient } from "@slack/web-api";

export interface PostMessageOptions {
  /** thread_ts — post as a threaded reply. */
  threadTs?: string;
  /** chat:write.customize display name. */
  username?: string;
  /** chat:write.customize avatar. */
  iconUrl?: string;
  /** Block Kit blocks (text remains the notification fallback). */
  blocks?: unknown[];
}

export interface SlackClient {
  /** Open (or fetch) the DM channel with a user; returns the channel id. */
  openDm(slackUserId: string): Promise<string>;
  /** Post a message to a channel; returns the message ts. */
  postMessage(channel: string, text: string, opts?: PostMessageOptions): Promise<string>;
  /** Edit an existing message (chat.update). */
  updateMessage(channel: string, ts: string, opts: { text: string; blocks?: unknown[] }): Promise<void>;
}

export interface SlackClientOptions {
  token?: string;
  /** Override the Slack API root (e.g. the stub). `/api/` is appended. */
  baseUrl?: string;
}

export function createSlackClient(opts: SlackClientOptions = {}): SlackClient {
  const token = opts.token ?? process.env.SLACK_BOT_TOKEN;
  const baseUrl = opts.baseUrl ?? process.env.SLACK_API_BASE_URL;
  const slackApiUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "").replace(/\/api$/, "")}/api/`
    : undefined; // WebClient defaults to https://slack.com/api/
  const web = new WebClient(token, {
    ...(slackApiUrl ? { slackApiUrl } : {}),
    retryConfig: { retries: 3 },
  });

  return {
    async openDm(slackUserId) {
      const res = await web.conversations.open({ users: slackUserId });
      if (!res.channel?.id) throw new Error("conversations.open returned no channel id");
      return res.channel.id;
    },
    async postMessage(channel, text, opts = {}) {
      const res = await web.chat.postMessage({
        channel,
        text,
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
        ...(opts.username ? { username: opts.username } : {}),
        ...(opts.iconUrl ? { icon_url: opts.iconUrl } : {}),
        ...(opts.blocks ? { blocks: opts.blocks as never } : {}),
      });
      if (!res.ts) throw new Error("chat.postMessage returned no ts");
      return res.ts;
    },
    async updateMessage(channel, ts, opts) {
      await web.chat.update({
        channel,
        ts,
        text: opts.text,
        ...(opts.blocks ? { blocks: opts.blocks as never } : {}),
      });
    },
  };
}
```

> The `as never` casts bridge our `unknown[]` blocks to `@slack/web-api`'s strict block union without pulling its `KnownBlock` types through our interface. This is intentional and the only place we sidestep its block typing.

- [ ] **Step 5: Run from repo root, confirm PASS** (existing + 2 new)

Run: `pnpm exec vitest run packages/slack-client/src/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check the package**

Run: `pnpm --filter @poddaily/slack-client exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/slack-client/src/index.ts packages/slack-client/src/index.test.ts
git commit -m "feat(slack-client): postMessage thread/customize options + updateMessage"
```

---

### Task 5: Worker `openRun` posts the opening message

**Files:**
- Modify: `apps/worker/src/types.ts`
- Modify: `apps/worker/src/openRun.ts`
- Modify: `apps/worker/src/processor.ts`
- Test: `apps/worker/src/openRun.test.ts`

- [ ] **Step 1: Add `slack` to `OpenRunDeps`** — in `apps/worker/src/types.ts`:

```ts
export interface OpenRunDeps {
  db: Db;
  enqueueSend: EnqueueSend;
  slack: SlackClient;
}
```
(`SlackClient` is already imported at the top of `types.ts`.)

- [ ] **Step 2: Post the opening message in `openRun`** — in `apps/worker/src/openRun.ts`:

Update the import line to pull in the builder:
```ts
import { anchorDate, isActiveWeekday, computeSendInstant, buildOpeningMessage } from "@poddaily/shared";
```
Destructure `slack`:
```ts
  const { db, enqueueSend, slack } = deps;
```
Then, **after** `const runId = inserted[0].id;` and **after** the `members` query (so `members.length` is known), insert this block **before** the fan-out `for` loop:

```ts
  // Post the channel opening message once per run (best-effort) and store its ts for
  // threading. teamId is non-null here (guarded above). chat:write.customize attribution
  // for the per-report replies happens in the api on completion.
  try {
    const [team] = await db
      .select({ channelId: schema.teams.slackChannelId })
      .from(schema.teams)
      .where(eq(schema.teams.id, standup.teamId));
    if (team?.channelId) {
      const opening = buildOpeningMessage({
        standupName: standup.name,
        date,
        reported: 0,
        total: members.length,
      });
      const openingTs = await slack.postMessage(team.channelId, opening.text, { blocks: opening.blocks });
      await db
        .update(schema.standupRuns)
        .set({ channelOpeningTs: openingTs })
        .where(eq(schema.standupRuns.id, runId));
    }
  } catch (err) {
    console.warn(`[broadcast] opening message failed for run ${runId}:`, (err as Error).message);
  }
```

(`schema`, `eq` are already imported in `openRun.ts`; `date` is the existing `anchorDate(...)` value — i.e. `run.scheduledDate`.)

- [ ] **Step 3: Pass `slack` into `openRun`** — in `apps/worker/src/processor.ts`, update the `open-run` branch:

```ts
    if (job.name === "open-run") {
      const { standupId } = job.data as { standupId: string };
      await openRun({ db, enqueueSend, slack }, standupId, new Date());
    } else if (job.name === "send-dm") {
```
(`slack` is already destructured from `deps` at the top of `createProcessor`.)

- [ ] **Step 4: Fix `openRun.test.ts` deps + add an opening-message assertion** — open `apps/worker/src/openRun.test.ts`. Every `openRun({ db, enqueueSend }, …)` call now needs a `slack`. Add a fake recorder near the top of the test file:

```ts
function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    openDm: async () => "D_FAKE",
    postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts_open"; },
    updateMessage: async () => {},
  };
}
```
Update each `openRun({ db, enqueueSend }, …)` call to `openRun({ db, enqueueSend, slack }, …)` where `const slack = fakeSlack();` is created in the test. In the happy-path test (the one that seeds a team + standup + members and asserts a run opens and sends are enqueued), add assertions that the opening message was posted and its ts stored:

```ts
  expect(slack.posts.some((p) => p.text.includes("Reported: 0 out of"))).toBe(true);
  const [openedRun] = await sql`select channel_opening_ts from standup_runs where id = ${result.runId}`;
  expect(openedRun.channel_opening_ts).toBe("ts_open");
```
(Adapt the seed's channel/standup-name references to whatever the existing test already sets up; the test already seeds a team with a `slack_channel_id`, so the opening post will target it.)

- [ ] **Step 5: Run the worker unit tests from repo root, confirm PASS**

Run: `pnpm exec vitest run apps/worker/src/openRun.test.ts`
Expected: PASS (existing assertions + the opening-message ones). Requires local Postgres.

- [ ] **Step 6: Type-check the worker**

Run: `pnpm --filter @poddaily/worker exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/types.ts apps/worker/src/openRun.ts apps/worker/src/processor.ts apps/worker/src/openRun.test.ts
git commit -m "feat(worker): openRun posts channel opening message + stores ts"
```

---

### Task 6: api `handleMessage` broadcasts the report on completion

**Files:**
- Modify: `apps/api/src/handleMessage.ts`
- Test: `apps/api/src/handleMessage.test.ts`

- [ ] **Step 1: Write the failing test** — add to `apps/api/src/handleMessage.test.ts`. The existing file seeds a team + standup + run + in_progress report and uses a `fakeSlack()` recorder. Extend `fakeSlack()` (or add a richer one) to capture post options + updates, and seed the run with a `channel_opening_ts` so the broadcast threads. Add:

```ts
it("broadcasts the completed report as a threaded reply and updates the counter", async () => {
  // Give the shared run an opening ts + a channel on the team so the broadcast can post.
  await sql`update standup_runs set channel_opening_ts = 'open_ts_1' where id = ${runId}`;

  const posts: Array<{ channel: string; text: string; opts: any }> = [];
  const updates: Array<{ channel: string; ts: string; text: string }> = [];
  const slack = {
    openDm: async () => "D",
    postMessage: async (channel: string, text: string, opts: any = {}) => { posts.push({ channel, text, opts }); return "post_ts_1"; },
    updateMessage: async (channel: string, ts: string, o: any) => { updates.push({ channel, ts, text: o.text }); },
  };

  await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 1" });
  await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 2" });

  // The threaded report reply: posted to the team channel, threaded, attributed to the member.
  const reply = posts.find((p) => p.opts?.threadTs === "open_ts_1");
  expect(reply).toBeTruthy();
  expect(reply!.opts.username).toBe("HM Tester");
  expect(reply!.channel).toBe(CHAN); // team channel from the seeded team

  // channel_post_ts persisted.
  const [r] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
  expect(r.channel_post_ts).toBe("post_ts_1");

  // Counter updated to 1 of 1.
  const upd = updates.find((u) => u.ts === "open_ts_1");
  expect(upd?.text).toContain("Reported: 1 out of 1");
});

it("does not throw and leaves the report completed when broadcast has no opening ts", async () => {
  await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
  const slack = fakeSlack();
  await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "a1" });
  await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "a2" });
  const [r] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER}`;
  expect(r.status).toBe("completed");
  expect(r.channel_post_ts).toBeNull();
});
```

> The existing test seeds the team with `slack_channel_id = CHAN` (a constant in the file) and the run as `runId`. Reuse those exact identifiers. The two-question standup means the second reply completes the report. The `fakeSlack()` already in the file (returning `posts`) is fine for the second test.

- [ ] **Step 2: Run from repo root, confirm the new cases FAIL** (no broadcast yet)

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`
Expected: FAIL on the broadcast cases (no threaded post / no counter update).

- [ ] **Step 3: Implement the broadcast** — in `apps/api/src/handleMessage.ts`:

Update the imports:
```ts
import { schema, eq, and, desc } from "@poddaily/db";
import { advanceReport, buildOpeningMessage, buildReportBlocks } from "@poddaily/shared";
import type { ReportAnswer } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";
```

In the `complete` branch, after the outro post, call the broadcast helper:
```ts
    case "complete":
      await db.update(schema.standupReports)
        .set({ answers: action.answers, status: "completed", reportedAt: new Date() })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, standup.outroMessage ?? DEFAULT_OUTRO);
      await broadcastReport({ db, slack }, { report, run, standup, answers: action.answers });
      return;
```

Add the helper at the bottom of the file (after `handleMessage`):
```ts
/**
 * Best-effort channel broadcast: post the completed report as a threaded reply under the
 * run's opening message (attributed to the member via chat:write.customize), persist the
 * post ts, and refresh the "Reported: n out of total" counter. Any failure is logged and
 * swallowed so a broadcast problem never reverts the completed report.
 */
async function broadcastReport(
  deps: HandleMessageDeps,
  ctx: {
    report: typeof schema.standupReports.$inferSelect;
    run: typeof schema.standupRuns.$inferSelect;
    standup: typeof schema.standups.$inferSelect;
    answers: ReportAnswer[];
  },
): Promise<void> {
  const { db, slack } = deps;
  const { report, run, standup, answers } = ctx;
  try {
    if (!run.channelOpeningTs) {
      console.warn(`[broadcast] run ${run.id} has no opening ts; skipping report ${report.id}`);
      return;
    }
    if (!standup.teamId) return;

    const [team] = await db
      .select({ channelId: schema.teams.slackChannelId })
      .from(schema.teams)
      .where(eq(schema.teams.id, standup.teamId));
    if (!team?.channelId) return;

    const [member] = await db
      .select({ avatar: schema.teamMembers.slackAvatarUrl })
      .from(schema.teamMembers)
      .where(and(
        eq(schema.teamMembers.teamId, standup.teamId),
        eq(schema.teamMembers.slackUserId, report.slackUserId),
      ));

    const built = buildReportBlocks({
      standupName: standup.name,
      displayName: report.slackDisplayName,
      answers,
    });
    const postTs = await slack.postMessage(team.channelId, built.text, {
      threadTs: run.channelOpeningTs,
      username: report.slackDisplayName,
      iconUrl: member?.avatar ?? undefined,
      blocks: built.blocks,
    });
    await db.update(schema.standupReports)
      .set({ channelPostTs: postTs })
      .where(eq(schema.standupReports.id, report.id));

    // Refresh the counter from the run's reports (total = fanned-out, reported = completed).
    const all = await db
      .select({ status: schema.standupReports.status })
      .from(schema.standupReports)
      .where(eq(schema.standupReports.runId, run.id));
    const total = all.length;
    const reported = all.filter((r) => r.status === "completed").length;
    const opening = buildOpeningMessage({
      standupName: standup.name,
      date: run.scheduledDate,
      reported,
      total,
    });
    await slack.updateMessage(team.channelId, run.channelOpeningTs, { text: opening.text, blocks: opening.blocks });
  } catch (err) {
    console.warn(`[broadcast] degraded for report ${report.id}:`, (err as Error).message);
  }
}
```

- [ ] **Step 4: Run from repo root, confirm the api tests PASS** (existing + 2 new)

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the api**

Run: `pnpm --filter @poddaily/api exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handleMessage.ts apps/api/src/handleMessage.test.ts
git commit -m "feat(api): broadcast completed report to channel thread + update counter"
```

---

### Task 7: `smoke:standup` broadcast assertions (end-to-end)

**Files:**
- Modify: `apps/api/tests/standup-smoke.test.ts`

- [ ] **Step 1: Extend the smoke** — open `apps/api/tests/standup-smoke.test.ts`. After the two `handleMessage` calls that complete the Q&A, add broadcast assertions. The team's channel is the seeded `CHAN` constant; DM messages go to a different channel (the stub's DM id), so filter by `CHAN`:

```ts
    // --- broadcast assertions (6a) ---
    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{
      channel: string; text: string; thread_ts?: string; username?: string;
    }>;
    const channelMsgs = msgs.filter((m) => m.channel === CHAN);

    // opening message posted to the team channel by the worker
    expect(channelMsgs.some((m) => m.text.includes("Reported: 0 out of 1"))).toBe(true);

    // threaded report reply, attributed to the member
    const reply = channelMsgs.find((m) => m.thread_ts && m.username === "Standup Tester");
    expect(reply).toBeTruthy();
    expect(reply!.text).toContain("Build the inbound engine");

    // channel_post_ts persisted on the report
    const [reportRow] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(reportRow.channel_post_ts).not.toBeNull();

    // opening counter updated to 1 of 1
    const updates = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<{ text: string }>;
    expect(updates.some((u) => u.text.includes("Reported: 1 out of 1"))).toBe(true);
```

> The existing smoke seeds the team with `slack_channel_id = CHAN`, the member display name `'Standup Tester'`, and answers `"Shipped the scheduler"` / `"Build the inbound engine"`. Reuse those exact values. The worker in this smoke is built with `createProcessor({ db, slack, queue })`, so `openRun` already receives `slack` — no harness change needed beyond the assertions.

- [ ] **Step 2: Run the smoke from repo root** (Redis + Postgres up)

Run: `docker compose up -d redis && pnpm exec vitest run apps/api/tests/standup-smoke.test.ts`
Expected: PASS — the opening message, threaded reply, persisted ts, and counter update all assert true.

- [ ] **Step 3: Run the full suite** (no regressions)

Run: `pnpm test`
Expected: PASS — all files green, including the new broadcast unit tests, the extended smoke, and the existing 5a/5b suites.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/standup-smoke.test.ts
git commit -m "test(api): smoke:standup asserts channel broadcast + counter"
```

---

### Task 8: Definition-of-done — docs

**Files:**
- Modify: `README.md`
- Modify: `ContextDB/02_architecture/slack-integration.md`
- Modify: `ContextDB/00_index/getting-started.md`
- Create: `ContextDB/08_logs/2026-06-20-step6a-channel-broadcast.md`

- [ ] **Step 1: README** — Do **not** tick the "posted as the user" checklist line yet (true authorship is 6b). Instead, append a sub-note to that line so it reads:

```markdown
- [ ] Channel broadcast posted as the user, threaded under a daily opening message
  - [x] Threaded broadcast shipped in Step 6a via the bot with the member's name/avatar (`chat:write.customize`); true post-as-user authorship is Step 6b
```

Also add to the worker/api configuration prose: the bot **must be invited to each team's channel** (otherwise channel posts fail with `not_in_channel`, logged as `[broadcast] degraded`). Add the bot scope `chat:write.customize` to any scope list.

- [ ] **Step 2: `slack-integration.md`** — under "## Channel broadcast", add a status note: implemented in Step 6a (opening message by the worker at run-open with a live counter; threaded per-report replies by the api via `chat:write.customize`); user-token authorship is pending Step 6b.

- [ ] **Step 3: `getting-started.md`** — add a short "Step 6a — channel broadcast" note in the worker/api area: after a member completes their DM, the report appears threaded under the daily opening message in the team channel; the bot must be a member of that channel. Mention `pnpm smoke:standup` covers it.

- [ ] **Step 4: Build log** — create `ContextDB/08_logs/2026-06-20-step6a-channel-broadcast.md` following the [5b log](../../../ContextDB/08_logs/2026-06-20-step5b-inbound-dm-qa.md) structure: What shipped (schema column, pure builders, slack-client extension, worker opening message, api threaded broadcast + counter, smoke), Verification (paste `pnpm test` totals), Notable decisions (Approach A eager-opening; counter derived from reports; best-effort isolation; chat:write.customize → 6b boundary; bot-must-be-in-channel), and an honest DoD status (automated smoke green; live runbook + the `not_in_channel` operational step pending the human walk).

- [ ] **Step 5: Final verification**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add README.md ContextDB/02_architecture/slack-integration.md ContextDB/00_index/getting-started.md ContextDB/08_logs/2026-06-20-step6a-channel-broadcast.md
git commit -m "docs: Step 6a — channel broadcast (README, slack-integration, runbook, log)"
```

---

## Self-Review

**Spec coverage** (against the [6a design spec](../specs/2026-06-20-step6a-channel-broadcast-design.md)):
- Schema `channel_opening_ts` → Task 1. ✓
- Pure builders `buildOpeningMessage` / `buildReportBlocks` → Task 2. ✓
- slack-client `PostMessageOptions` + `updateMessage` → Task 4 (stub support Task 3). ✓
- Worker eager opening message + store ts (Approach A) → Task 5. ✓
- api threaded reply (chat:write.customize) + `channel_post_ts` + counter via chat.update → Task 6. ✓
- Best-effort isolation (try/catch, null-opening-ts skip) → Tasks 5 & 6. ✓
- Counter derived from `standup_reports` (total = all, reported = completed) → Task 6. ✓
- smoke broadcast assertions → Task 7. ✓
- DoD docs incl. bot-must-be-in-channel + the 6a/6b README boundary → Task 8. ✓

**Placeholder scan:** no TBD/"handle errors" — every code step shows complete code; doc steps name exact edits. Tasks 4/5/6 reference reading the current file first because they extend existing patterns, but the edits themselves are concrete. ✓

**Type consistency:** `BuiltMessage { text, blocks }` returned by both builders (Task 2) and consumed in Tasks 5 & 6. `PostMessageOptions { threadTs, username, iconUrl, blocks }` defined in Task 4 and used identically in Tasks 5 & 6. `OpenRunDeps.slack` added in Task 5 step 1 and supplied by the processor in step 3. `run.channelOpeningTs` / `run.scheduledDate` (camelCase Drizzle fields) used consistently; raw SQL in tests uses snake_case (`channel_opening_ts`, `channel_post_ts`) correctly. `buildOpeningMessage`'s `date` is `run.scheduledDate` on both the worker (Task 5) and api (Task 6) sides, so the heading is byte-identical across post + update. ✓
