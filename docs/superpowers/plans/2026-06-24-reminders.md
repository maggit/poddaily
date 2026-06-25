# Standup Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recurring DM reminders nudge members who haven't finished today's standup, at a per-standup interval (default 60 min) up to the existing 4h timeout.

**Architecture:** A pure `reminderDelays(intervalMs, timeoutMs)` produces the reminder fire-times (< timeout). At each report-clock start (`sendDm` + `retrigger`), enqueue one delayed `reminder` job per delay. The `reminder` worker job DM-nudges the member only if their report is still `in_progress` (mirrors the timeout job), then records a `standup_reminders` row. Interval is a new per-standup column surfaced on the config page.

**Tech Stack:** Drizzle + drizzle-kit migrations, BullMQ, `@poddaily/shared`, Next.js (config UI), Vitest.

Source: [reminders spec](../specs/2026-06-24-reminders-design.md).

---

## File Structure

```
packages/db/src/schema.ts (+ migrations/000N_*.sql + meta)   # reminder_interval_minutes
packages/shared/src/reminders.ts (+ test) + index.ts         # reminderDelays
packages/shared/src/queue-contract.ts                        # REMINDER_JOB + ReminderJob
apps/worker/src/remindReport.ts (+ test)                     # reminder handler
apps/worker/src/types.ts                                     # EnqueueReminders + ReminderJob re-export + SendDmDeps
apps/worker/src/queue.ts                                     # makeEnqueueReminders
apps/worker/src/sendDm.ts · retrigger.ts · processor.ts      # enqueue + dispatch + wiring
apps/web/lib/standups.ts (+ standups.test.ts)                # reminderIntervalMinutes in config
apps/web/components/standups/standup-form.tsx                # interval field
apps/web/app/(dashboard)/teams/[id]/standup/page.tsx         # parse + pass + default
README.md · ContextDB/08_logs/2026-06-24-reminders.md        # DoD
```

---

### Task 1: Schema — `reminder_interval_minutes` column + migration

**Files:** Modify `packages/db/src/schema.ts`; generated `packages/db/migrations/000N_*.sql` + meta.

- [ ] **Step 1: Add the column** — in `packages/db/src/schema.ts`, in the `standups` table (after `isActive`), add:

```ts
  reminderIntervalMinutes: integer("reminder_interval_minutes").notNull().default(60),
```
Ensure `integer` is imported from `drizzle-orm/pg-core` at the top (it imports `pgTable, text, uuid, jsonb, boolean, timestamp, date` — add `integer` if missing).

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @poddaily/db generate`
Expected: a new `packages/db/migrations/0003_*.sql` (auto-named) + an updated `meta/_journal.json` and `0003_snapshot.json`. Open the `.sql` and confirm it is `ALTER TABLE "standups" ADD COLUMN "reminder_interval_minutes" integer DEFAULT 60 NOT NULL;` (drizzle may omit NOT NULL ordering — the column + default 60 is what matters).

- [ ] **Step 3: Apply it to the local/dev DB**

Run: `pnpm --filter @poddaily/db migrate`
Expected: applies cleanly. (CI/tests run against a migrated DB; the existing standup inserts in tests omit the column and get the default 60.)

- [ ] **Step 4: Verify the schema type-checks + db tests pass**

```
pnpm --filter @poddaily/db exec tsc --noEmit 2>/dev/null || npx tsc --noEmit --strict packages/db/src/schema.ts
docker compose up -d redis >/dev/null 2>&1
pnpm exec vitest run packages/db/src/schema.test.ts packages/db/src/runs.test.ts
```
Expected: clean / pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations
git commit -m "feat(db): standups.reminder_interval_minutes (default 60)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Shared — `reminderDelays` + job contract

**Files:** Create `packages/shared/src/reminders.ts`, `packages/shared/src/reminders.test.ts`; Modify `packages/shared/src/index.ts`, `packages/shared/src/queue-contract.ts`.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/reminders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reminderDelays } from "./reminders";

const M = 60_000;
describe("reminderDelays", () => {
  it("returns each interval multiple strictly before the timeout", () => {
    expect(reminderDelays(60 * M, 240 * M)).toEqual([60 * M, 120 * M, 180 * M]);
  });
  it("excludes a multiple that lands exactly on the timeout", () => {
    expect(reminderDelays(120 * M, 240 * M)).toEqual([120 * M]);
  });
  it("returns [] when the interval is 0 or negative (reminders off)", () => {
    expect(reminderDelays(0, 240 * M)).toEqual([]);
    expect(reminderDelays(-5, 240 * M)).toEqual([]);
  });
  it("returns [] when the interval is >= the timeout", () => {
    expect(reminderDelays(300 * M, 240 * M)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — `pnpm exec vitest run packages/shared/src/reminders.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `packages/shared/src/reminders.ts`**

```ts
/**
 * The delays (ms from report-clock start) at which to fire reminders: every `intervalMs`
 * strictly before `timeoutMs`. `intervalMs <= 0` (reminders off) → []. Pure.
 */
export function reminderDelays(intervalMs: number, timeoutMs: number): number[] {
  if (intervalMs <= 0) return [];
  const out: number[] = [];
  for (let t = intervalMs; t < timeoutMs; t += intervalMs) out.push(t);
  return out;
}
```

- [ ] **Step 4: Export it + add the job contract**
  - `packages/shared/src/index.ts`: add `export * from "./reminders";` (alphabetically among the others).
  - `packages/shared/src/queue-contract.ts`: append:
```ts
/** BullMQ job name for a reminder nudge. */
export const REMINDER_JOB = "reminder";

/** Payload for a reminder job — nudge a member who hasn't finished today's run. */
export interface ReminderJob {
  runId: string;
  slackUserId: string;
}
```

- [ ] **Step 5: Run, verify PASS** — `pnpm exec vitest run packages/shared/src/reminders.test.ts` → all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/reminders.ts packages/shared/src/reminders.test.ts packages/shared/src/index.ts packages/shared/src/queue-contract.ts
git commit -m "feat(shared): reminderDelays + reminder job contract

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Worker — `remindReport` handler + dispatch

**Files:** Create `apps/worker/src/remindReport.ts`, `apps/worker/src/remindReport.test.ts`; Modify `apps/worker/src/processor.ts`.

- [ ] **Step 1: Write the failing test** — `apps/worker/src/remindReport.test.ts` (real PG, fake slack):

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { remindReport } from "./remindReport";

const { db, sql } = createDb();
const CHAN = "C_REMIND";
const USER = "U_REMIND";

function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return { posts, openDm: async () => "D_R", postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts"; }, updateMessage: async () => {}, getUserProfile: async () => ({ image: null, tz: null, realName: null }) };
}
async function cleanup() {
  await sql`delete from standup_reminders where slack_user_id = ${USER}`;
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });
async function seed(status: "in_progress" | "completed" | "timed_out"): Promise<string> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Remind Pod', ${CHAN}, 'rem') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 9 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'Remind Tester', ${JSON.stringify([])}, ${status})`;
  return run.id;
}

describe("remindReport", () => {
  it("nudges and records a reminder when the report is in_progress", async () => {
    const runId = await seed("in_progress");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain("Daily Standup");
    const rows = await sql`select * from standup_reminders where slack_user_id = ${USER}`;
    expect(rows).toHaveLength(1);
  });
  it("no-ops when the report is completed", async () => {
    const runId = await seed("completed");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(0);
    const rows = await sql`select * from standup_reminders where slack_user_id = ${USER}`;
    expect(rows).toHaveLength(0);
  });
  it("no-ops when the report is timed_out", async () => {
    const runId = await seed("timed_out");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** — `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/worker/src/remindReport.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `apps/worker/src/remindReport.ts`**

```ts
import { schema, eq, and } from "@poddaily/db";
import type { ReminderJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { Db } from "./types";

export interface RemindReportDeps {
  db: Db;
  slack: SlackClient;
}

/**
 * Nudge a member who hasn't finished today's run. No-op if their report is no longer
 * in_progress (already completed / timed out). Records a standup_reminders row (best-effort).
 */
export async function remindReport(deps: RemindReportDeps, job: ReminderJob): Promise<void> {
  const { db, slack } = deps;

  const [report] = await db
    .select({ status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, job.runId), eq(schema.standupReports.slackUserId, job.slackUserId)));
  if (!report || report.status !== "in_progress") return;

  let standupName = "standup";
  const [run] = await db.select({ standupId: schema.standupRuns.standupId }).from(schema.standupRuns).where(eq(schema.standupRuns.id, job.runId));
  if (run?.standupId) {
    const [s] = await db.select({ name: schema.standups.name }).from(schema.standups).where(eq(schema.standups.id, run.standupId));
    if (s?.name) standupName = s.name;
  }

  const channelId = await slack.openDm(job.slackUserId);
  await slack.postMessage(channelId, `👋 Reminder — you haven't finished today's *${standupName}* yet. Just reply here to pick up where you left off.`);

  try {
    await db.insert(schema.standupReminders).values({ runId: job.runId, slackUserId: job.slackUserId, type: "reminder" });
  } catch (err) {
    console.warn(`[reminder] could not record reminder for ${job.slackUserId}:`, (err as Error).message);
  }
}
```

- [ ] **Step 4: Dispatch in the processor** — in `apps/worker/src/processor.ts`:
  - imports: add `import { remindReport } from "./remindReport";` and add `REMINDER_JOB` + `ReminderJob` to the `@poddaily/shared` imports (value `REMINDER_JOB`, type `ReminderJob`).
  - add a branch after the `retrigger` branch, before the `else { throw }`:
```ts
    } else if (job.name === REMINDER_JOB) {
      await remindReport({ db, slack }, job.data as ReminderJob);
```

- [ ] **Step 5: Run, verify PASS + type-check**

```
pnpm exec vitest run apps/worker/src/remindReport.test.ts
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: 3 pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/remindReport.ts apps/worker/src/remindReport.test.ts apps/worker/src/processor.ts
git commit -m "feat(worker): remindReport handler — nudge unfinished members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Worker — enqueue the reminder series (producer)

**Files:** Modify `apps/worker/src/types.ts`, `apps/worker/src/queue.ts`, `apps/worker/src/sendDm.ts`, `apps/worker/src/retrigger.ts`, `apps/worker/src/processor.ts`; update affected tests.

- [ ] **Step 1: Types** — in `apps/worker/src/types.ts`:
  - add `ReminderJob` to the shared import + re-export: change the existing `import type { SendDmJob } from "@poddaily/shared";` to `import type { SendDmJob, ReminderJob } from "@poddaily/shared";` and `export type { SendDmJob };` to `export type { SendDmJob, ReminderJob };`.
  - add the enqueue type (after `EnqueueTimeout`):
```ts
/** Enqueue the reminder series for a report (every intervalMs, < timeoutMs). */
export type EnqueueReminders = (job: ReminderJob, opts: { intervalMs: number; timeoutMs: number }) => Promise<void>;
```
  - add `enqueueReminders` to `SendDmDeps`:
```ts
export interface SendDmDeps {
  db: Db;
  slack: SlackClient;
  enqueueTimeout: EnqueueTimeout;
  enqueueReminders: EnqueueReminders;
}
```

- [ ] **Step 2: `makeEnqueueReminders`** — in `apps/worker/src/queue.ts`, add `REMINDER_JOB` to the `@poddaily/shared` import, add `import { reminderDelays } from "@poddaily/shared";`, add `EnqueueReminders` + `ReminderJob` to the `./types` import, and append:

```ts
/** An EnqueueReminders backed by a real BullMQ queue — one reminder job per delay. */
export function makeEnqueueReminders(queue: Queue): EnqueueReminders {
  return async (job: ReminderJob, opts: { intervalMs: number; timeoutMs: number }) => {
    for (const delayMs of reminderDelays(opts.intervalMs, opts.timeoutMs)) {
      await queue.add(REMINDER_JOB, job, {
        delay: delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }
  };
}
```

- [ ] **Step 3: Enqueue from `sendDm`** — in `apps/worker/src/sendDm.ts`: destructure `enqueueReminders` (`const { db, slack, enqueueTimeout, enqueueReminders } = deps;`), and after the `await enqueueTimeout(...)` line at the end add:

```ts
  await enqueueReminders(
    { runId, slackUserId },
    { intervalMs: (standup.reminderIntervalMinutes ?? 0) * 60_000, timeoutMs },
  );
```

- [ ] **Step 4: Enqueue from `retrigger`** — in `apps/worker/src/retrigger.ts`: add `enqueueReminders: EnqueueReminders` to `RetriggerDeps` (import `EnqueueReminders` from `./types`), destructure it, and after the `await enqueueTimeout(...)` line add the same call (note `runId: run.id`):

```ts
  await enqueueReminders(
    { runId: run.id, slackUserId: job.slackUserId },
    { intervalMs: (standup.reminderIntervalMinutes ?? 0) * 60_000, timeoutMs },
  );
```

- [ ] **Step 5: Wire the processor** — in `apps/worker/src/processor.ts`: add `import { makeEnqueueSend, makeEnqueueTimeout, makeEnqueueReminders } from "./queue";` (extend the existing import), build `const enqueueReminders = makeEnqueueReminders(queue);`, and pass `enqueueReminders` into BOTH the `sendDm({ db, slack, enqueueTimeout, enqueueReminders }, ...)` and `retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, ...)` calls.

- [ ] **Step 6: Update affected tests** — `SendDmDeps` and `RetriggerDeps` now require `enqueueReminders`. Find every test that constructs these deps and add a no-op (or spy):
  - `apps/worker/src/retrigger.test.ts`: its `retrigger({ db, slack, enqueueSend, enqueueTimeout }, ...)` calls need `enqueueReminders: async () => {}` added (add a `const enqueueReminders = async () => {};` or reuse a spy). Run `grep -rn "enqueueTimeout" apps/worker` to find any direct `sendDm(...)` test deps too and add the field.
  - Add ONE assertion proving the series is enqueued: in the file that unit-tests `sendDm` (if present) assert the spy is called; if `sendDm` has no direct unit test, add a minimal one OR assert via the outbound smoke (Step 7) — do not skip coverage silently.

- [ ] **Step 7: Verify**

```
docker compose up -d redis >/dev/null 2>&1
pnpm exec vitest run apps/worker
pnpm --filter @poddaily/worker exec tsc --noEmit
```
Expected: all worker tests pass (incl. `standup-outbound-smoke`, which exercises `sendDm` through the processor with the real `enqueueReminders`); tsc clean.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/types.ts apps/worker/src/queue.ts apps/worker/src/sendDm.ts apps/worker/src/retrigger.ts apps/worker/src/processor.ts apps/worker/src/retrigger.test.ts
git commit -m "feat(worker): enqueue the reminder series at each report-clock start

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Web — per-standup reminder interval (config)

**Files:** Modify `apps/web/lib/standups.ts`, `apps/web/components/standups/standup-form.tsx`, `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`; Test `apps/web/lib/standups.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `apps/web/lib/standups.test.ts` (inside the `describe`), using the existing `teamId`:

```ts
  it("round-trips reminderIntervalMinutes", async () => {
    await upsertStandup(teamId, {
      questions: [{ id: "q1", text: "Only one?", type: "text" }],
      scheduleCron: "0 10 * * 1",
      scheduleTz: "UTC",
      introMessage: "Hi!",
      outroMessage: "Thanks!",
      reminderIntervalMinutes: 30,
    });
    const got = await getStandup(teamId);
    expect(got?.reminderIntervalMinutes).toBe(30);
  });
```

- [ ] **Step 2: Run, verify it FAILS** — `pnpm exec vitest run apps/web/lib/standups.test.ts` → FAIL (`reminderIntervalMinutes` not in `StandupConfig` / not persisted).

- [ ] **Step 3: Implement in `apps/web/lib/standups.ts`** — add the field to `StandupConfig` and to the `upsertStandup` `values`:
  - In `interface StandupConfig` add: `reminderIntervalMinutes: number;`
  - In `upsertStandup`'s `values` object add: `reminderIntervalMinutes: config.reminderIntervalMinutes,`

(`getStandup` returns the full row, so `reminderIntervalMinutes` is already present on reads.)

- [ ] **Step 4: Run, verify PASS** — `pnpm exec vitest run apps/web/lib/standups.test.ts` → pass.

- [ ] **Step 5: Add the form field** — in `apps/web/components/standups/standup-form.tsx`:
  - add `reminderIntervalMinutes: number;` to the props type and `reminderIntervalMinutes` to the destructured params.
  - inside the intro/outro `<section className="grid gap-4 sm:grid-cols-2">`, add a third labelled field:
```tsx
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Reminder interval (minutes, 0 = off)</span>
          <input type="number" name="reminderIntervalMinutes" defaultValue={reminderIntervalMinutes} min={0} step={5} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
```

- [ ] **Step 6: Parse + pass it in the page** — in `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`:
  - compute the default near the other defaults: `const reminderIntervalMinutes = standup?.reminderIntervalMinutes ?? 60;`
  - in `saveAction`, parse and clamp before `upsertStandup`, and include it in the call:
```ts
    const reminderIntervalMinutes = Math.max(0, Math.floor(Number(fd.get("reminderIntervalMinutes") ?? 60)) || 0);
```
    add `reminderIntervalMinutes,` to the `upsertStandup(id, { ... })` object.
  - pass the prop to the form: add `reminderIntervalMinutes={reminderIntervalMinutes}` to `<StandupForm ... />`.

- [ ] **Step 7: Type-check**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/standups.ts apps/web/lib/standups.test.ts apps/web/components/standups/standup-form.tsx "apps/web/app/(dashboard)/teams/[id]/standup/page.tsx"
git commit -m "feat(web): per-standup reminder interval on the config page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Definition-of-done — docs + full verify

**Files:** Modify `README.md`; Create `ContextDB/08_logs/2026-06-24-reminders.md`.

- [ ] **Step 1: README** — near the standup-config / admin notes, add a "Reminders" note: members who haven't finished today's standup get recurring **DM** nudges at a per-standup interval (config page field, **default 60 min**, `0` = off) until they finish or hit the 4h timeout. Note it's driven by the worker (`REDIS_URL` already required there); no new env or Slack config.

- [ ] **Step 2: Build log** — create `ContextDB/08_logs/2026-06-24-reminders.md` (follow prior logs): What shipped (`reminder_interval_minutes` column + migration; `reminderDelays`; `reminder` job + `remindReport`; enqueue at `sendDm`+`retrigger`; config-page field), Verification (`pnpm test` totals), Notable decisions (automatic + recurring; per-standup interval default 60; enqueue-all-up-front; DM nudge; at-least-once; config changes apply to future runs), and Phase 2 remaining (D — RBAC).

- [ ] **Step 3: Full verification**

```
pnpm --filter @poddaily/db migrate
docker compose up -d redis >/dev/null 2>&1
pnpm test
```
Expected: all green — paste totals. If anything fails, STOP and report.

- [ ] **Step 4: Commit**

```bash
git add README.md ContextDB/08_logs/2026-06-24-reminders.md
git commit -m "docs: standup reminders (README, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Per-standup `reminder_interval_minutes` (default 60) + migration → Task 1. ✓
- `reminderDelays` pure + `< timeout` boundary + `0`=off → Task 2 (+test). ✓
- `REMINDER_JOB` + `ReminderJob` contract → Task 2. ✓
- `reminder` job nudges only if `in_progress`, records `standup_reminders` → Task 3 (+test). ✓
- Enqueue series at both report-clock starts (`sendDm` + `retrigger`; late-join via `send-dm`) → Task 4. ✓
- Per-standup interval surfaced on the config page (default 60) → Task 5 (+test). ✓
- DM nudge (not channel) → Task 3 (`openDm` + post). ✓
- At-least-once / best-effort record / config-applies-to-future-runs → inherent (Tasks 3, 4). ✓
- DoD docs + migration applied → Task 6. ✓

**Placeholder scan:** every code step has complete code; the migration filename is auto-generated (Task 1 Step 2 says to commit whatever `generate` produces, verifying the SQL content). No TBDs. ✓

**Type consistency:** `ReminderJob { runId, slackUserId }` (Task 2) used by `remindReport` (Task 3), `EnqueueReminders`/`makeEnqueueReminders` (Task 4), processor (Tasks 3+4). `reminderDelays(intervalMs, timeoutMs)` (Task 2) used by `makeEnqueueReminders` (Task 4). `SendDmDeps`/`RetriggerDeps` gain `enqueueReminders` (Task 4) — every constructor updated (processor + tests). `StandupConfig.reminderIntervalMinutes` (Task 5) ↔ `standups.reminderIntervalMinutes` column (Task 1) ↔ `StandupForm` prop (Task 5). ✓
