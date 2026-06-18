# Step 5a — Scheduler + Outbound Standup DM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the outbound half of the standup loop — a per-user-timezone BullMQ scheduler that opens one run per day and DMs every reporting member their intro + first question.

**Architecture:** Pure logic (`computeSendInstant`, cron derivation, reconcile diff) lives in `packages/shared` and is unit-tested with no I/O. The worker's `openRun` and `sendDm` are written as plain functions taking injected dependencies (db, a slack client, an enqueue callback), so they're integration-tested against local Postgres + the Slack stub **without Redis**. BullMQ is a thin shell in `apps/worker/src/index.ts` that wires those functions to a real queue; only the final smoke test spins real Redis end-to-end.

**Tech Stack:** TypeScript (ESM, NodeNext via esbuild/tsx), pnpm workspaces, Drizzle ORM + postgres.js, BullMQ + ioredis, Luxon (IANA/DST math), `@slack/web-api`, Vitest.

**Design source:** [docs/superpowers/specs/2026-06-17-step5a-scheduler-outbound-dm-design.md](../specs/2026-06-17-step5a-scheduler-outbound-dm-design.md)

---

## File structure

```
packages/shared/src/
  sendInstants.ts        NEW  pure: computeSendInstant, anchorDate, isActiveWeekday, deriveTickCron
  sendInstants.test.ts   NEW  unit tests (TZ, DST, weekday edges)
  index.ts               MOD  export ./sendInstants
packages/shared/package.json   MOD  add luxon dep + @types/luxon

packages/db/src/schema.ts      MOD  standupRuns.scheduledDate + unique; standupReports unique
packages/db/migrations/000X_*.sql  NEW  generated migration

packages/slack-client/
  package.json           NEW
  src/index.ts           NEW  createSlackClient (openDm, postMessage)
  src/index.test.ts      NEW  tests against the stub

tools/slack-stub/src/
  server.ts              MOD  + conversations.open, chat.postMessage, recorder, reset
  server.test.ts         MOD  + tests for the new endpoints

apps/worker/
  package.json           NEW
  tsconfig.json          NEW
  src/types.ts           NEW  shared worker types (SendDmJob, deps interfaces)
  src/reconcile.ts       NEW  pure diffSchedules
  src/reconcile.test.ts  NEW
  src/openRun.ts         NEW  openRun(deps, standupId, now)
  src/openRun.test.ts    NEW  integration (Postgres + fake enqueue)
  src/sendDm.ts          NEW  sendDm(deps, job)
  src/sendDm.test.ts     NEW  integration (Postgres + stub)
  src/queue.ts           NEW  BullMQ queue + connection + enqueueSend
  src/index.ts           NEW  boot: reconcile + Worker (open-run + send-dm)
  src/trigger.ts         NEW  CLI: enqueue an open-run job now
  tests/standup-outbound-smoke.test.ts  NEW  real Redis end-to-end

package.json (root)      MOD  add smoke:standup-outbound script
README.md                MOD  feature checklist + Redis/worker setup
ContextDB/02_architecture/scheduler.md   MOD  anchor/tick decisions
ContextDB/00_index/getting-started.md    MOD  worker demo runbook
ContextDB/00_index/project-map.md        MOD  Step 5a status
ContextDB/08_logs/2026-06-17-step5a-scheduler-outbound.md  NEW  build log
```

---

## Task 1: Pure send-instant math in `packages/shared`

**Files:**
- Create: `packages/shared/src/sendInstants.ts`
- Test: `packages/shared/src/sendInstants.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json`

- [ ] **Step 1: Add Luxon dependency**

Edit `packages/shared/package.json` to add a `dependencies` block (the package currently has none) and a `devDependencies` block:

```json
{
  "name": "@poddaily/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "luxon": "^3.5.0"
  },
  "devDependencies": {
    "@types/luxon": "^3.4.2"
  }
}
```

Then run: `pnpm install`
Expected: lockfile updates, luxon resolved.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/sendInstants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSendInstant, anchorDate, isActiveWeekday, deriveTickCron } from "./sendInstants";
import { cronFromWeekly } from "./schedule";

// "9:00 on Mon-Fri" in cron terms
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

describe("anchorDate", () => {
  it("returns the calendar date in scheduleTz", () => {
    // 2026-06-17T02:00:00Z is still 2026-06-16 in America/Mexico_City (UTC-6)
    const instant = new Date("2026-06-17T02:00:00Z");
    expect(anchorDate("America/Mexico_City", instant)).toBe("2026-06-16");
    expect(anchorDate("UTC", instant)).toBe("2026-06-17");
  });
});

describe("isActiveWeekday", () => {
  it("true on a configured weekday, evaluated in scheduleTz", () => {
    // 2026-06-17 is a Wednesday
    const wed = new Date("2026-06-17T12:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", wed)).toBe(true);
  });
  it("false on a non-configured weekday", () => {
    // 2026-06-20 is a Saturday
    const sat = new Date("2026-06-20T12:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", sat)).toBe(false);
  });
  it("uses scheduleTz to decide the weekday at a date boundary", () => {
    // 2026-06-22T02:00Z is Mon in UTC but still Sun in America/Mexico_City
    const instant = new Date("2026-06-22T02:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", instant)).toBe(true);              // Monday
    expect(isActiveWeekday(CRON, "America/Mexico_City", instant)).toBe(false); // Sunday
  });
});

describe("computeSendInstant", () => {
  it("is the member's local configured time on the anchor date", () => {
    // anchor 2026-06-17, member in New York (UTC-4 in June) → 09:00 EDT = 13:00Z
    const instant = computeSendInstant(CRON, "America/New_York", "2026-06-17");
    expect(instant.toISOString()).toBe("2026-06-17T13:00:00.000Z");
  });
  it("differs per member timezone for the same anchor date", () => {
    const ny = computeSendInstant(CRON, "America/New_York", "2026-06-17");   // 13:00Z
    const ldn = computeSendInstant(CRON, "Europe/London", "2026-06-17");      // 09:00 BST = 08:00Z
    expect(ldn.toISOString()).toBe("2026-06-17T08:00:00.000Z");
    expect(ny.getTime()).toBeGreaterThan(ldn.getTime());
  });
  it("handles a winter (standard time) offset correctly", () => {
    // January: New York is UTC-5 → 09:00 EST = 14:00Z
    const instant = computeSendInstant(CRON, "America/New_York", "2026-01-14");
    expect(instant.toISOString()).toBe("2026-01-14T14:00:00.000Z");
  });
});

describe("deriveTickCron", () => {
  it("reuses weekdays but fires at 00:05", () => {
    expect(deriveTickCron(CRON)).toBe("5 0 * * 1,2,3,4,5");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/sendInstants.test.ts`
Expected: FAIL — `Failed to resolve import "./sendInstants"`.

- [ ] **Step 4: Write the implementation**

Create `packages/shared/src/sendInstants.ts`:

```ts
import { DateTime } from "luxon";
import { parseWeeklyCron } from "./schedule";

/** Convert a Luxon weekday (1=Mon..7=Sun) to a cron day-of-week (0=Sun..6=Sat). */
function luxonToCronDow(weekday: number): number {
  return weekday === 7 ? 0 : weekday;
}

/** The run's anchor calendar date (YYYY-MM-DD) for `instant`, evaluated in `scheduleTz`. */
export function anchorDate(scheduleTz: string, instant: Date): string {
  const iso = DateTime.fromJSDate(instant, { zone: scheduleTz }).toISODate();
  if (!iso) throw new Error(`Invalid instant/zone: ${instant.toISOString()} / ${scheduleTz}`);
  return iso;
}

/** Is `instant`'s date an active weekday for this standup, evaluated in `scheduleTz`? */
export function isActiveWeekday(cron: string, scheduleTz: string, instant: Date): boolean {
  const { weekdays } = parseWeeklyCron(cron);
  const dt = DateTime.fromJSDate(instant, { zone: scheduleTz });
  return weekdays.includes(luxonToCronDow(dt.weekday));
}

/**
 * The UTC instant at which a member in `memberTz` should be DM'd for the run
 * anchored on `anchorDateISO` (a YYYY-MM-DD date in the standup's scheduleTz),
 * at the standup's configured local time. Luxon resolves the IANA offset
 * (including DST) for that wall-clock time in `memberTz`.
 */
export function computeSendInstant(cron: string, memberTz: string, anchorDateISO: string): Date {
  const { hour, minute } = parseWeeklyCron(cron);
  const dt = DateTime.fromISO(anchorDateISO, { zone: memberTz }).set({
    hour, minute, second: 0, millisecond: 0,
  });
  if (!dt.isValid) throw new Error(`Invalid send instant for ${memberTz} on ${anchorDateISO}: ${dt.invalidReason}`);
  return dt.toJSDate();
}

/** Repeatable-tick cron derived from a standup cron: same weekdays, fires at 00:05. */
export function deriveTickCron(cron: string): string {
  const { weekdays } = parseWeeklyCron(cron);
  const dows = [...new Set(weekdays)].sort((a, b) => a - b).join(",");
  return `5 0 * * ${dows}`;
}
```

- [ ] **Step 5: Export from the package index**

Edit `packages/shared/src/index.ts`, adding one line:

```ts
export * from "./dates";
export * from "./questions";
export * from "./schedule";
export * from "./sendInstants";
export * from "./timezones";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/sendInstants.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sendInstants.ts packages/shared/src/sendInstants.test.ts packages/shared/src/index.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(shared): pure per-user-TZ send-instant math (Luxon)"
```

---

## Task 2: Idempotency schema deltas + migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/000X_*.sql` (generated)

- [ ] **Step 1: Add the `date` import and schema changes**

Edit `packages/db/src/schema.ts`. Change the import line to include `date`:

```ts
import {
  pgTable, uuid, text, boolean, timestamp, jsonb, unique, date,
} from "drizzle-orm/pg-core";
```

Replace the `standupRuns` table definition with one that adds `scheduledDate` and a unique constraint:

```ts
export const standupRuns = pgTable("standup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  standupId: uuid("standup_id").references(() => standups.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  scheduledDate: date("scheduled_date").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqRunPerDay: unique().on(t.standupId, t.scheduledDate) }));
```

Replace the `standupReports` table definition to add a unique constraint:

```ts
export const standupReports = pgTable("standup_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => standupRuns.id),
  slackUserId: text("slack_user_id").notNull(),
  slackDisplayName: text("slack_display_name").notNull(),
  answers: jsonb("answers").$type<ReportAnswer[]>().notNull(),
  status: text("status").default("in_progress"),
  dmThreadTs: text("dm_thread_ts"),
  channelPostTs: text("channel_post_ts"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqReportPerMember: unique().on(t.runId, t.slackUserId) }));
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `packages/db/migrations/000X_*.sql` containing `ALTER TABLE "standup_runs" ADD COLUMN "scheduled_date" date NOT NULL`, plus two `ADD CONSTRAINT ... UNIQUE` statements. (drizzle-kit prints the created file name.)

- [ ] **Step 3: Apply the migration to local DB**

Ensure local Postgres is running (`supabase start` or the project's DB). Run: `pnpm db:migrate`
Expected: migration applies with no error.

> If `db:migrate` reports the column can't be added `NOT NULL` to existing rows, the local DB has stale `standup_runs` rows — clear them first with `psql` (`delete from standup_runs;`) since no real runs exist yet, then re-run.

- [ ] **Step 4: Verify schema smoke still passes**

Run: `pnpm seed && pnpm smoke:db`
Expected: `✓ smoke:db PASSED`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): one-run-per-day + one-report-per-member unique constraints"
```

---

## Task 3: Extend the Slack stub with Web API fakes + recorder

**Files:**
- Modify: `tools/slack-stub/src/server.ts`
- Modify: `tools/slack-stub/src/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tools/slack-stub/src/server.test.ts` (append inside the file, after the existing `describe` block):

```ts
async function postForm(url: string, body: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("slack web api stub", () => {
  it("conversations.open returns a deterministic DM channel id", async () => {
    const res = await postForm(`${stub.url}/api/conversations.open`, { users: "U123" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.channel.id).toMatch(/^D/);
    // deterministic for the same user
    const res2 = await postForm(`${stub.url}/api/conversations.open`, { users: "U123" });
    expect((await res2.json()).channel.id).toBe(body.channel.id);
  });

  it("chat.postMessage records the message and returns a ts", async () => {
    await postForm(`${stub.url}/__stub/reset`, {});
    const res = await postForm(`${stub.url}/api/chat.postMessage`, { channel: "D1", text: "hello world" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ channel: "D1", text: "hello world" });
  });

  it("reset clears the recorded messages", async () => {
    await postForm(`${stub.url}/api/chat.postMessage`, { channel: "D1", text: "x" });
    await postForm(`${stub.url}/__stub/reset`, {});
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tools/slack-stub/src/server.test.ts`
Expected: FAIL — new endpoints return 404 / `ok:false`.

- [ ] **Step 3: Implement the new endpoints + recorder**

Edit `tools/slack-stub/src/server.ts`. Add a recorder and a body reader near the top (after the imports), and handle the new routes inside `createServer`.

Replace the whole file with:

```ts
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface SlackStub {
  url: string;
  close: () => Promise<void>;
}

export interface RecordedMessage {
  channel: string;
  text: string;
}

const STUB_USER = {
  sub: "U_ADMIN_STUB",
  "https://slack.com/user_id": "U_ADMIN_STUB",
  name: "Stub Admin",
  email: "admin@stub.local",
  picture: "https://stub.local/avatar.png",
};

function readBody(req: import("node:http").IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(new URLSearchParams(raw)));
  });
}

/** Deterministic fake DM channel id for a given user list. */
function dmChannelId(users: string): string {
  let hash = 0;
  for (const ch of users) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `D${hash.toString(36).toUpperCase()}`;
}

export function startSlackStub(port = 4010): Promise<SlackStub> {
  const messages: RecordedMessage[] = [];
  let tsCounter = 1000;

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    // --- OIDC (admin auth) ---
    if (u.pathname === "/openid/connect/authorize") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const location = `${redirectUri}?code=STUB_CODE&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      return res.end();
    }
    if (u.pathname === "/api/openid.connect.token") {
      return json(200, { ok: true, access_token: "STUB_ACCESS_TOKEN", token_type: "Bearer", id_token: "stub.id.token" });
    }
    if (u.pathname === "/api/openid.connect.userInfo") {
      return json(200, { ok: true, ...STUB_USER });
    }

    // --- Web API (bot) ---
    if (u.pathname === "/api/conversations.open") {
      const body = await readBody(req);
      const users = body.get("users") ?? "";
      return json(200, { ok: true, channel: { id: dmChannelId(users) } });
    }
    if (u.pathname === "/api/chat.postMessage") {
      const body = await readBody(req);
      messages.push({ channel: body.get("channel") ?? "", text: body.get("text") ?? "" });
      return json(200, { ok: true, ts: String(tsCounter++) });
    }

    // --- Test introspection ---
    if (u.pathname === "/__stub/messages") {
      return json(200, messages);
    }
    if (u.pathname === "/__stub/reset") {
      messages.length = 0;
      return json(200, { ok: true });
    }

    json(404, { ok: false, error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tools/slack-stub/src/server.test.ts`
Expected: PASS (OIDC tests + the three new Web API tests).

- [ ] **Step 5: Commit**

```bash
git add tools/slack-stub/src/server.ts tools/slack-stub/src/server.test.ts
git commit -m "feat(slack-stub): fake conversations.open + chat.postMessage with recorder"
```

---

## Task 4: `packages/slack-client` wrapper

**Files:**
- Create: `packages/slack-client/package.json`
- Create: `packages/slack-client/src/index.ts`
- Create: `packages/slack-client/src/index.test.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/slack-client/package.json`:

```json
{
  "name": "@poddaily/slack-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@slack/web-api": "^7.8.0"
  }
}
```

Run: `pnpm install`
Expected: `@slack/web-api` resolved into the workspace.

- [ ] **Step 2: Write the failing test**

Create `packages/slack-client/src/index.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { createSlackClient } from "./index";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("slack-client", () => {
  it("opens a DM and returns the channel id", async () => {
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const channelId = await client.openDm("U999");
    expect(channelId).toMatch(/^D/);
  });

  it("posts a message and returns its ts, recorded by the stub", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const ts = await client.postMessage("D1", "good morning");
    expect(ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toEqual([{ channel: "D1", text: "good morning" }]);
  });
});
```

Add `@poddaily/slack-stub` as a dev dependency so the test can import it. Edit `packages/slack-client/package.json` to add:

```json
  "devDependencies": {
    "@poddaily/slack-stub": "workspace:*"
  }
```

Then run `pnpm install` again.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/slack-client/src/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 4: Implement the client**

Create `packages/slack-client/src/index.ts`:

```ts
import { WebClient } from "@slack/web-api";

export interface SlackClient {
  /** Open (or fetch) the DM channel with a user; returns the channel id. */
  openDm(slackUserId: string): Promise<string>;
  /** Post a plain-text message to a channel; returns the message ts. */
  postMessage(channel: string, text: string): Promise<string>;
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
    ? `${baseUrl.replace(/\/$/, "")}/api/`
    : undefined; // WebClient defaults to https://slack.com/api/
  const web = new WebClient(token, slackApiUrl ? { slackApiUrl } : {});

  return {
    async openDm(slackUserId) {
      const res = await web.conversations.open({ users: slackUserId });
      if (!res.ok || !res.channel?.id) {
        throw new Error(`conversations.open failed: ${res.error ?? "unknown"}`);
      }
      return res.channel.id;
    },
    async postMessage(channel, text) {
      const res = await web.chat.postMessage({ channel, text });
      if (!res.ok || !res.ts) {
        throw new Error(`chat.postMessage failed: ${res.error ?? "unknown"}`);
      }
      return res.ts;
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/slack-client/src/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slack-client pnpm-lock.yaml
git commit -m "feat(slack-client): thin @slack/web-api wrapper (openDm, postMessage)"
```

---

## Task 5: Worker scaffold + pure reconcile diff

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/types.ts`
- Create: `apps/worker/src/reconcile.ts`, `apps/worker/src/reconcile.test.ts`

- [ ] **Step 1: Create the worker manifest + tsconfig**

Create `apps/worker/package.json`:

```json
{
  "name": "@poddaily/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "trigger": "tsx src/trigger.ts"
  },
  "dependencies": {
    "@poddaily/db": "workspace:*",
    "@poddaily/shared": "workspace:*",
    "@poddaily/slack-client": "workspace:*",
    "bullmq": "^5.34.0"
  },
  "devDependencies": {
    "@poddaily/slack-stub": "workspace:*",
    "tsx": "^4.16.0"
  }
}
```

Create `apps/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src"]
}
```

Run: `pnpm install`
Expected: bullmq + workspace deps resolved.

- [ ] **Step 2: Create the shared worker types**

Create `apps/worker/src/types.ts`:

```ts
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

export type Db = ReturnType<typeof createDb>["db"];

/** Payload for a per-member send-standup-dm job. */
export interface SendDmJob {
  runId: string;
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
}

/** Enqueue a send-standup-dm job, delayed `delayMs` from now (0 = immediate). */
export type EnqueueSend = (job: SendDmJob, opts: { delayMs: number }) => Promise<void>;

export interface OpenRunDeps {
  db: Db;
  enqueueSend: EnqueueSend;
}

export interface SendDmDeps {
  db: Db;
  slack: SlackClient;
}
```

- [ ] **Step 3: Write the failing reconcile test**

Create `apps/worker/src/reconcile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffSchedules, type ActiveStandup, type ExistingJob } from "./reconcile";

const standup = (id: string, cron: string, tz: string): ActiveStandup => ({ id, scheduleCron: cron, scheduleTz: tz });
const job = (standupId: string, pattern: string, tz: string): ExistingJob => ({ standupId, pattern, tz });

describe("diffSchedules", () => {
  it("adds a job for a standup with none", () => {
    const r = diffSchedules([standup("s1", "0 9 * * 1,2,3,4,5", "UTC")], []);
    expect(r.toAdd).toHaveLength(1);
    expect(r.toAdd[0]).toMatchObject({ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" });
    expect(r.toRemove).toHaveLength(0);
  });

  it("removes a job whose standup is no longer active", () => {
    const r = diffSchedules([], [job("s1", "5 0 * * 1,2,3,4,5", "UTC")]);
    expect(r.toAdd).toHaveLength(0);
    expect(r.toRemove).toEqual([{ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" }]);
  });

  it("recreates a job when the derived pattern or tz changed", () => {
    const active = [standup("s1", "0 9 * * 1,2,3", "UTC")];            // derived → "5 0 * * 1,2,3"
    const existing = [job("s1", "5 0 * * 1,2,3,4,5", "UTC")];          // stale weekdays
    const r = diffSchedules(active, existing);
    expect(r.toRemove).toEqual([{ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" }]);
    expect(r.toAdd[0]).toMatchObject({ standupId: "s1", pattern: "5 0 * * 1,2,3", tz: "UTC" });
  });

  it("leaves an unchanged job alone", () => {
    const active = [standup("s1", "0 9 * * 1,2,3,4,5", "UTC")];
    const existing = [job("s1", "5 0 * * 1,2,3,4,5", "UTC")];
    const r = diffSchedules(active, existing);
    expect(r.toAdd).toHaveLength(0);
    expect(r.toRemove).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run apps/worker/src/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcile"`.

- [ ] **Step 5: Implement the pure diff**

Create `apps/worker/src/reconcile.ts`:

```ts
import { deriveTickCron } from "@poddaily/shared";

export interface ActiveStandup {
  id: string;
  scheduleCron: string;
  scheduleTz: string;
}

/** A repeatable job currently registered in BullMQ, mapped to our shape. */
export interface ExistingJob {
  standupId: string;
  pattern: string;
  tz: string;
}

export interface DesiredJob {
  standupId: string;
  pattern: string;
  tz: string;
}

export interface ScheduleDiff {
  toAdd: DesiredJob[];
  toRemove: ExistingJob[];
}

/** Compute the repeatable-job changes needed to match `active` standups. */
export function diffSchedules(active: ActiveStandup[], existing: ExistingJob[]): ScheduleDiff {
  const desired: DesiredJob[] = active.map((s) => ({
    standupId: s.id,
    pattern: deriveTickCron(s.scheduleCron),
    tz: s.scheduleTz,
  }));

  const sameAsDesired = (e: ExistingJob) =>
    desired.some((d) => d.standupId === e.standupId && d.pattern === e.pattern && d.tz === e.tz);
  const alreadyExists = (d: DesiredJob) =>
    existing.some((e) => e.standupId === d.standupId && e.pattern === d.pattern && e.tz === d.tz);

  return {
    toAdd: desired.filter((d) => !alreadyExists(d)),
    toRemove: existing.filter((e) => !sameAsDesired(e)),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run apps/worker/src/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/package.json apps/worker/tsconfig.json apps/worker/src/types.ts apps/worker/src/reconcile.ts apps/worker/src/reconcile.test.ts pnpm-lock.yaml
git commit -m "feat(worker): scaffold + pure schedule reconcile diff"
```

---

## Task 6: `openRun` — open the run + fan out (integration, no Redis)

**Files:**
- Create: `apps/worker/src/openRun.ts`
- Create: `apps/worker/src/openRun.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/worker/src/openRun.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { openRun } from "./openRun";
import type { SendDmJob } from "./types";

const { db, sql } = createDb();

const CHAN = "C_OPENRUN";
// "09:00 Mon-Fri"
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

async function seedStandup(active = true) {
  const [team] = await sql`
    insert into teams (name, slack_channel_id, slack_channel_name)
    values ('OpenRun Pod', ${CHAN}, 'openrun-pod') returning id`;
  await sql`
    insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report)
    values (${team.id}, 'U_NY', 'NY User', 'America/New_York', true),
           (${team.id}, 'U_LDN', 'London User', 'Europe/London', true),
           (${team.id}, 'U_NOREPORT', 'Lurker', 'UTC', false)`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${sql.json([{ id: "q1", text: "What did you do?", type: "text" }])},
            ${CRON}, 'UTC', ${active})
    returning id`;
  return s.id as string;
}

beforeEach(async () => {
  await sql`delete from team_members where slack_user_id in ('U_NY','U_LDN','U_NOREPORT')`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
});
afterAll(async () => { await sql.end(); });

describe("openRun", () => {
  it("opens one run and enqueues a send per reporting member", async () => {
    const standupId = await seedStandup();
    const enqueued: Array<{ job: SendDmJob; delayMs: number }> = [];
    const now = new Date("2026-06-17T00:05:00Z"); // Wednesday, before any member 09:00

    const result = await openRun({ db, enqueueSend: async (job, opts) => { enqueued.push({ job, delayMs: opts.delayMs }); } }, standupId, now);

    expect(result.runId).toBeTruthy();
    expect(result.enqueued).toBe(2); // U_NOREPORT excluded
    const users = enqueued.map((e) => e.job.slackUserId).sort();
    expect(users).toEqual(["U_LDN", "U_NY"]);
    // London 09:00 BST = 08:00Z → delay ~ 7h55m from 00:05Z
    const ldn = enqueued.find((e) => e.job.slackUserId === "U_LDN")!;
    expect(ldn.delayMs).toBeGreaterThan(0);
    // a row exists
    const runs = await sql`select * from standup_runs where id = ${result.runId}`;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
  });

  it("is idempotent — a second openRun for the same day enqueues nothing new", async () => {
    const standupId = await seedStandup();
    const now = new Date("2026-06-17T00:05:00Z");
    const first: SendDmJob[] = [];
    await openRun({ db, enqueueSend: async (j) => { first.push(j); } }, standupId, now);
    const second: SendDmJob[] = [];
    const r2 = await openRun({ db, enqueueSend: async (j) => { second.push(j); } }, standupId, now);
    expect(second).toHaveLength(0);
    expect(r2.enqueued).toBe(0);
    const runs = await sql`select count(*)::int as n from standup_runs where standup_id = ${standupId}`;
    expect(runs[0].n).toBe(1);
  });

  it("does nothing on an inactive weekday", async () => {
    const standupId = await seedStandup();
    const sat = new Date("2026-06-20T00:05:00Z"); // Saturday
    const enq: SendDmJob[] = [];
    const r = await openRun({ db, enqueueSend: async (j) => { enq.push(j); } }, standupId, sat);
    expect(r.runId).toBeNull();
    expect(enq).toHaveLength(0);
  });

  it("does nothing for an inactive standup", async () => {
    const standupId = await seedStandup(false);
    const now = new Date("2026-06-17T00:05:00Z");
    const enq: SendDmJob[] = [];
    const r = await openRun({ db, enqueueSend: async (j) => { enq.push(j); } }, standupId, now);
    expect(r.runId).toBeNull();
    expect(enq).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/worker/src/openRun.test.ts`
Expected: FAIL — `Failed to resolve import "./openRun"`.

- [ ] **Step 3: Implement `openRun`**

Create `apps/worker/src/openRun.ts`:

```ts
import { schema, eq, and } from "@poddaily/db";
import { anchorDate, isActiveWeekday, computeSendInstant } from "@poddaily/shared";
import type { OpenRunDeps } from "./types";

export interface OpenRunResult {
  runId: string | null;
  enqueued: number;
}

/**
 * Open today's run for a standup and fan out a send-standup-dm job per reporting
 * member. Idempotent: the unique (standup_id, scheduled_date) constraint means a
 * second call for the same day inserts no run and fans out nothing.
 */
export async function openRun(deps: OpenRunDeps, standupId: string, now: Date): Promise<OpenRunResult> {
  const { db, enqueueSend } = deps;

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup || !standup.isActive) return { runId: null, enqueued: 0 };
  if (!isActiveWeekday(standup.scheduleCron, standup.scheduleTz, now)) return { runId: null, enqueued: 0 };

  const date = anchorDate(standup.scheduleTz, now);

  // Insert the run; on conflict (already opened today) do nothing and bail out.
  const inserted = await db
    .insert(schema.standupRuns)
    .values({ standupId, scheduledAt: now, scheduledDate: date, status: "running", startedAt: now })
    .onConflictDoNothing({ target: [schema.standupRuns.standupId, schema.standupRuns.scheduledDate] })
    .returning();
  if (inserted.length === 0) return { runId: null, enqueued: 0 };
  const runId = inserted[0].id;

  const members = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, standup.teamId!), eq(schema.teamMembers.canReport, true)));

  for (const m of members) {
    const tz = m.timezone ?? standup.scheduleTz;
    const sendAt = computeSendInstant(standup.scheduleCron, tz, date);
    const delayMs = Math.max(0, sendAt.getTime() - now.getTime());
    await enqueueSend(
      { runId, standupId, slackUserId: m.slackUserId, slackDisplayName: m.slackDisplayName },
      { delayMs },
    );
  }

  return { runId, enqueued: members.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/worker/src/openRun.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/openRun.ts apps/worker/src/openRun.test.ts
git commit -m "feat(worker): openRun opens a daily run and fans out per-member sends"
```

---

## Task 7: `sendDm` — open DM, post intro + Q1, insert report (integration + stub)

**Files:**
- Create: `apps/worker/src/sendDm.ts`
- Create: `apps/worker/src/sendDm.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `apps/worker/src/sendDm.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { createDb } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { sendDm } from "./sendDm";

const { db, sql } = createDb();
const CHAN = "C_SENDDM";
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); await sql.end(); });

async function seedRun(intro: string | null) {
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SendDm Pod', ${CHAN}, 'senddm-pod') returning id`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
    values (${team.id}, 'Daily Standup',
            ${sql.json([{ id: "q1", text: "What have you done since {last_report_date}?", type: "text" }])},
            ${CRON}, 'UTC', ${intro}, true)
    returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  return { standupId: s.id as string, runId: run.id as string };
}

beforeEach(async () => {
  await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
  await sql`delete from standup_reports where slack_user_id = 'U_SEND'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
});

describe("sendDm", () => {
  it("opens a DM, posts intro + interpolated Q1, inserts an in_progress report", async () => {
    const { standupId, runId } = await seedRun("Good morning! :wave:");
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });

    await sendDm({ db, slack }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(2); // intro + Q1
    expect(log[0].text).toBe("Good morning! :wave:");
    expect(log[1].text).toContain("What have you done since");
    expect(log[1].text).toContain("your last report"); // no prior report → fallback

    const reports = await sql`select * from standup_reports where run_id = ${runId} and slack_user_id = 'U_SEND'`;
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("in_progress");
    expect(reports[0].answers).toEqual([]);
    expect(reports[0].dm_thread_ts).toBeTruthy();
  });

  it("skips the intro post when introMessage is null (Q1 only)", async () => {
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    await sendDm({ db, slack }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(1);
    expect(log[0].text).toContain("What have you done since");
  });

  it("is safe to retry — a second call does not double-insert the report or repost", async () => {
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const job = { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" };
    await sendDm({ db, slack }, job);
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await sendDm({ db, slack }, job);

    const reports = await sql`select count(*)::int as n from standup_reports where run_id = ${runId} and slack_user_id = 'U_SEND'`;
    expect(reports[0].n).toBe(1);
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(0); // second call short-circuited before posting
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`
Expected: FAIL — `Failed to resolve import "./sendDm"`.

- [ ] **Step 3: Implement `sendDm`**

Create `apps/worker/src/sendDm.ts`. It guards against re-posting on retry by checking for an existing report first, then posts and inserts (the unique constraint is the backstop under a race).

```ts
import { schema, eq, and, desc } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import type { SendDmDeps, SendDmJob } from "./types";

/**
 * Open the member's DM, post the intro (if any) + the interpolated first question,
 * and insert the in_progress report. Idempotent: if a report already exists for
 * (runId, slackUserId) we short-circuit before posting, so BullMQ retries never
 * double-DM. The unique (run_id, slack_user_id) constraint is the backstop.
 */
export async function sendDm(deps: SendDmDeps, job: SendDmJob): Promise<void> {
  const { db, slack } = deps;
  const { runId, standupId, slackUserId, slackDisplayName } = job;

  const existing = await db
    .select({ id: schema.standupReports.id })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, runId), eq(schema.standupReports.slackUserId, slackUserId)));
  if (existing.length > 0) return; // already sent — retry no-op

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup) throw new Error(`sendDm: standup ${standupId} not found`);
  const firstQuestion = standup.questions[0];
  if (!firstQuestion) throw new Error(`sendDm: standup ${standupId} has no questions`);

  // Most recent completed report for this user → last_report_date.
  const [last] = await db
    .select({ reportedAt: schema.standupReports.reportedAt })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.slackUserId, slackUserId), eq(schema.standupReports.status, "completed")))
    .orderBy(desc(schema.standupReports.reportedAt))
    .limit(1);
  const q1Text = interpolateLastReportDate(firstQuestion.text, last?.reportedAt ?? null);

  const channelId = await slack.openDm(slackUserId);
  let firstTs: string | null = null;
  if (standup.introMessage) {
    firstTs = await slack.postMessage(channelId, standup.introMessage);
  }
  const q1Ts = await slack.postMessage(channelId, q1Text);

  await db
    .insert(schema.standupReports)
    .values({
      runId,
      slackUserId,
      slackDisplayName,
      answers: [],
      status: "in_progress",
      dmThreadTs: firstTs ?? q1Ts,
    })
    .onConflictDoNothing({ target: [schema.standupReports.runId, schema.standupReports.slackUserId] });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/sendDm.ts apps/worker/src/sendDm.test.ts
git commit -m "feat(worker): sendDm opens DM, posts intro + Q1, inserts in_progress report"
```

---

## Task 8: BullMQ wiring — queue, worker boot, trigger CLI

**Files:**
- Create: `apps/worker/src/queue.ts`, `apps/worker/src/index.ts`, `apps/worker/src/trigger.ts`

> These are the thin BullMQ shell — no unit tests here (logic is already covered in Tasks 5–7; the wiring is exercised end-to-end by the smoke test in Task 9).

- [ ] **Step 1: Create the queue module**

Create `apps/worker/src/queue.ts`:

```ts
import { Queue } from "bullmq";
import type { SendDmJob, EnqueueSend } from "./types";

export const QUEUE_NAME = "standup";

/** BullMQ connection options derived from REDIS_URL. */
export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return { url };
}

export function createQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: redisConnection() });
}

/** An EnqueueSend backed by a real BullMQ queue. */
export function makeEnqueueSend(queue: Queue): EnqueueSend {
  return async (job: SendDmJob, opts: { delayMs: number }) => {
    await queue.add("send-dm", job, {
      delay: opts.delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  };
}

/** Enqueue an open-run job to fire immediately (used by trigger + scheduler tick). */
export async function enqueueOpenRun(queue: Queue, standupId: string): Promise<void> {
  await queue.add("open-run", { standupId }, { removeOnComplete: true, removeOnFail: false });
}
```

- [ ] **Step 2: Create the worker boot (index.ts)**

Create `apps/worker/src/index.ts`:

```ts
import { Worker, type Job } from "bullmq";
import { createDb, schema, eq } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { QUEUE_NAME, createQueue, makeEnqueueSend, redisConnection, enqueueOpenRun } from "./queue";
import { diffSchedules, type ExistingJob } from "./reconcile";
import { openRun } from "./openRun";
import { sendDm } from "./sendDm";
import type { SendDmJob } from "./types";

const REPEAT_PREFIX = "open-run"; // repeatable job name

/** Reconcile repeatable open-run jobs against the active standups. */
async function reconcile(queue: ReturnType<typeof createQueue>, db: ReturnType<typeof createDb>["db"]) {
  const active = await db
    .select({ id: schema.standups.id, scheduleCron: schema.standups.scheduleCron, scheduleTz: schema.standups.scheduleTz })
    .from(schema.standups)
    .where(eq(schema.standups.isActive, true));

  const repeatables = await queue.getRepeatableJobs();
  const existing: ExistingJob[] = repeatables
    .filter((r) => r.name === REPEAT_PREFIX && r.id)
    .map((r) => ({ standupId: r.id as string, pattern: r.pattern ?? "", tz: r.tz ?? "" }));

  const { toAdd, toRemove } = diffSchedules(active, existing);
  for (const r of toRemove) {
    await queue.removeRepeatableByKey(repeatables.find((j) => j.id === r.standupId && j.pattern === r.pattern)!.key);
  }
  for (const a of toAdd) {
    await queue.add(REPEAT_PREFIX, { standupId: a.standupId }, {
      jobId: a.standupId,
      repeat: { pattern: a.pattern, tz: a.tz, immediately: false },
    });
  }
  console.log(`[reconcile] active=${active.length} added=${toAdd.length} removed=${toRemove.length}`);
}

async function main() {
  const { db } = createDb();
  const slack = createSlackClient();
  const queue = createQueue();

  await reconcile(queue, db);

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "open-run") {
        const { standupId } = job.data as { standupId: string };
        await openRun({ db, enqueueSend: makeEnqueueSend(queue) }, standupId, new Date());
      } else if (job.name === "send-dm") {
        await sendDm({ db, slack }, job.data as SendDmJob);
      }
    },
    { connection: redisConnection() },
  );

  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} (${job?.name}) failed:`, err.message));
  worker.on("completed", (job) => console.log(`[worker] job ${job.id} (${job.name}) done`));
  console.log("[worker] started");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});

export { enqueueOpenRun };
```

- [ ] **Step 3: Create the trigger CLI**

Create `apps/worker/src/trigger.ts`:

```ts
import { createQueue, enqueueOpenRun } from "./queue";

async function main() {
  const standupId = process.argv[2];
  if (!standupId) {
    console.error("usage: pnpm --filter @poddaily/worker trigger <standupId>");
    process.exit(1);
  }
  const queue = createQueue();
  await enqueueOpenRun(queue, standupId);
  await queue.close();
  console.log(`[trigger] enqueued open-run for standup ${standupId}`);
}

main().catch((err) => {
  console.error("[trigger] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Type-check the worker**

Run: `pnpm --filter @poddaily/worker exec tsc --noEmit -p tsconfig.json`
Expected: no type errors. (If `getRepeatableJobs()` field names differ in the installed bullmq version, adjust the `.pattern`/`.tz`/`.id`/`.key` access to match — the test in Task 9 will catch a wiring mistake.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/queue.ts apps/worker/src/index.ts apps/worker/src/trigger.ts
git commit -m "feat(worker): BullMQ queue, worker boot + reconcile, trigger CLI"
```

---

## Task 9: End-to-end smoke with real Redis

**Files:**
- Create: `apps/worker/tests/standup-outbound-smoke.test.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Add the smoke script**

Edit the root `package.json` `scripts` block, adding one line after `smoke:config`:

```json
    "smoke:config": "vitest run apps/web/tests/config-smoke.test.ts apps/web/lib/standups.test.ts packages/shared/src/schedule.test.ts",
    "smoke:standup-outbound": "vitest run apps/worker/tests/standup-outbound-smoke.test.ts"
```

- [ ] **Step 2: Write the smoke test**

Create `apps/worker/tests/standup-outbound-smoke.test.ts`. It boots a real BullMQ Queue + Worker against `REDIS_URL`, opens a run via the actual code path, and polls the stub until the member's DM is recorded.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker, type Job } from "bullmq";
import { createDb, schema, eq } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { openRun } from "../src/openRun";
import { sendDm } from "../src/sendDm";
import { makeEnqueueSend, enqueueOpenRun } from "../src/queue";
import type { SendDmJob } from "../src/types";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "standup-smoke"; // isolated queue name for the test
const { db, sql } = createDb();
const CHAN = "C_SMOKE_OUTBOUND";
const CRON = cronFromWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 0, minute: 0 }); // every day, 00:00 → immediate send

let stub: SlackStub;
let queue: Queue;
let worker: Worker;

beforeAll(async () => {
  stub = await startSlackStub(0);
  process.env.SLACK_API_BASE_URL = stub.url;
  process.env.SLACK_BOT_TOKEN = "xoxb-smoke";

  queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  await queue.obliterate({ force: true }); // clean slate
  const slack = createSlackClient();
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "open-run") {
        await openRun({ db, enqueueSend: makeEnqueueSend(queue) }, job.data.standupId, new Date());
      } else if (job.name === "send-dm") {
        await sendDm({ db, slack }, job.data as SendDmJob);
      }
    },
    { connection: { url: REDIS_URL } },
  );
});

afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await stub.close();
  await sql`delete from standup_reports where slack_user_id = 'U_SMOKE_OUT'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = 'U_SMOKE_OUT'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("smoke:standup-outbound", () => {
  it("trigger → run opens → member receives intro + Q1 via BullMQ", async () => {
    // clean + seed
    await sql`delete from standup_reports where slack_user_id = 'U_SMOKE_OUT'`;
    await sql`delete from team_members where slack_user_id = 'U_SMOKE_OUT'`;
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Smoke Out Pod', ${CHAN}, 'smoke-out') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, 'U_SMOKE_OUT', 'Smoke Out', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${sql.json([{ id: "q1", text: "What did you do?", type: "text" }])},
              ${CRON}, 'UTC', 'Morning!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await enqueueOpenRun(queue, s.id);

    const log = await waitFor(
      async () => (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ channel: string; text: string }>,
      (l) => l.length >= 2,
    );
    expect(log[0].text).toBe("Morning!");
    expect(log[1].text).toBe("What did you do?");

    const reports = await sql`select * from standup_reports where slack_user_id = 'U_SMOKE_OUT' and status = 'in_progress'`;
    expect(reports).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Start Redis and run the smoke**

Run: `docker compose up -d redis`
Then: `REDIS_URL=redis://127.0.0.1:6379 pnpm smoke:standup-outbound`
Expected: PASS — the member receives intro + Q1 and the report row exists.

- [ ] **Step 4: Run the full unit + integration suite**

Run: `pnpm test`
Expected: all tests pass (the new shared/worker/slack-client/stub tests + the existing suite). The smoke test also runs here and needs Redis up.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/tests/standup-outbound-smoke.test.ts package.json
git commit -m "test(worker): smoke:standup-outbound end-to-end via real Redis"
```

---

## Task 10: Docs — README, runbook, context, build log

**Files:**
- Modify: `README.md`
- Modify: `ContextDB/02_architecture/scheduler.md`
- Modify: `ContextDB/00_index/getting-started.md`
- Modify: `ContextDB/00_index/project-map.md`
- Create: `ContextDB/08_logs/2026-06-17-step5a-scheduler-outbound.md`

- [ ] **Step 1: Update the README feature checklist + setup**

In `README.md`, tick the scheduler/outbound-DM item(s) in the Phase-1 feature checklist (match the existing checkbox style), and add a short setup note in the local-dev / running section:

```markdown
### Worker (scheduler + standup DMs)

The worker schedules and sends standup DMs. It needs Redis:

    docker compose up -d redis          # local Redis for BullMQ
    pnpm --filter @poddaily/worker dev  # boots the scheduler + DM worker

Trigger a run immediately (instead of waiting for the daily tick):

    pnpm --filter @poddaily/worker trigger <standupId>

Env: `REDIS_URL` (BullMQ), `SLACK_BOT_TOKEN` (bot DM posting). In tests/smoke,
`SLACK_API_BASE_URL` points the bot client at the local Slack stub.
```

Edit only what's accurate; do not invent checklist items that don't exist. Read the current checklist section first and tick the matching line(s).

- [ ] **Step 2: Update scheduler.md with the locked decisions**

In `ContextDB/02_architecture/scheduler.md`, add a short subsection documenting: the canonical date anchor (run is for date D in `scheduleTz`; active-weekday evaluated once in `scheduleTz`; each member DM'd at their local configured time on date D), the 00:05-in-`scheduleTz` derived tick, and the two idempotency constraints. Keep it consistent with the existing doc's voice.

- [ ] **Step 3: Add the worker demo runbook to getting-started**

In `ContextDB/00_index/getting-started.md`, add a "Run the standup worker (Step 5a)" section mirroring the README worker note, plus the local demo walk: `docker compose up -d redis` → seed/use the existing test team with one member (the operator) + an active standup → `pnpm --filter @poddaily/worker dev` → `… trigger <standupId>` → member receives intro + Q1; `standup_reports` row is `in_progress`.

- [ ] **Step 4: Update the project map**

In `ContextDB/00_index/project-map.md`, update the Step 5 line to reflect the 5a/5b split and mark 5a as the active work (mirror the Step 3 sub-bullet style):

```markdown
- 🚧 Step 5 — scheduler + DM Q&A engine (the core). Split into 5a/5b.
  - 🚧 5a — scheduler + outbound standup DM (`apps/worker`, `packages/slack-client`, `smoke:standup-outbound`) — **in progress**. [Design](../../docs/superpowers/specs/2026-06-17-step5a-scheduler-outbound-dm-design.md) · [Plan](../../docs/superpowers/plans/2026-06-17-step5a-scheduler-outbound-dm.md)
  - 5b — `apps/api` + inbound `message.im` Q&A engine + `smoke:standup`.
```

- [ ] **Step 5: Write the build log**

Create `ContextDB/08_logs/2026-06-17-step5a-scheduler-outbound.md` summarizing what shipped (worker + slack-client + stub extension + scheduler/openRun/sendDm + schema deltas + smoke), how it was verified (unit/integration/smoke commands and results), and the operator note (Redis dependency; prod deploy of worker+Redis deferred to bundle with 5b). Follow the format of the existing `08_logs/2026-06-17-migrate-on-deploy.md`.

- [ ] **Step 6: Commit**

```bash
git add README.md ContextDB/02_architecture/scheduler.md ContextDB/00_index/getting-started.md ContextDB/00_index/project-map.md ContextDB/08_logs/2026-06-17-step5a-scheduler-outbound.md
git commit -m "docs: Step 5a — scheduler + outbound DM (README, runbook, context, log)"
```

---

## Final verification

- [ ] `pnpm test` — full suite green (Redis up).
- [ ] `pnpm smoke:standup-outbound` — green (Redis up).
- [ ] `pnpm smoke:db && pnpm smoke:auth && pnpm smoke:team && pnpm smoke:config` — no regressions.
- [ ] Local demo walk done once against the real dev workspace test team (member receives intro + Q1).
- [ ] Open a PR from `feat/step5a-scheduler-outbound-dm` into `main`.

> **Out of 5a (carried to 5b/later):** `apps/api` + inbound `message.im` Q&A engine, `complete` + outro, full `smoke:standup`, web standup-config-write → reconcile trigger, and prod deploy of the worker + Redis to Dokploy.
