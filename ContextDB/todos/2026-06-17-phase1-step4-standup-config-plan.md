# Phase 1 — Step 4: Standup Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can configure a team's single standup — questions (add / remove / reorder / inline-edit), schedule (weekdays + time + timezone), and intro/outro messages — persisted to the `standups` row, verified by `smoke:config`.

**Architecture:** Reuses the Step 3 pattern: a TDD'd data-access layer (`apps/web/lib/standups.ts`) and pure schedule↔cron helpers in `@poddaily/shared`. A `/teams/[id]/standup` page with a client-side standup form (manages questions + schedule state) that posts to a Server Action calling `upsertStandup`. One standup per team (`standups.team_id` is UNIQUE → upsert). No Slack, no BullMQ — the repeatable-job registration is Step 5's scheduler; Step 4 just persists config correctly.

**Tech Stack:** Next.js 15 Server Components + Server Actions, Drizzle (`@poddaily/db`, operators re-exported), `@poddaily/shared`, Vitest, existing design system.

Source: [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) §P0 standup config + §8 UI · [data-model](../02_architecture/data-model.md) (`standups`) · build step 4 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md).

> **Scope notes (documented, not gaps):** (1) reorder uses up/down controls, not drag-and-drop —
> drag is a later polish (avoids a DnD dependency now). (2) `smoke:config` verifies the standup
> row persists with the right questions/cron/tz/messages; registering the BullMQ repeatable job
> is Step 5 (the scheduler), which doesn't exist yet.

---

## File Structure

```
packages/shared/src/schedule.ts        # WEEKDAYS, cronFromWeekly, parseWeeklyCron (+ test)
apps/web/lib/standups.ts               # getStandup, upsertStandup (+ test)
apps/web/app/(dashboard)/teams/[id]/standup/page.tsx   # config page + Server Action
apps/web/components/standups/
  ├─ standup-form.tsx                  # client: ties questions + schedule + messages, submits
  ├─ question-editor.tsx               # client: add/remove/move/inline-edit questions
  └─ schedule-picker.tsx               # client: weekday toggles + time + tz
apps/web/tests/config-smoke.test.ts    # smoke:config
```
The team detail page gets a "Configure standup" link.

---

### Task 1: Schedule ↔ cron helpers in shared (TDD)

**Files:**
- Create: `packages/shared/src/schedule.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schedule.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/schedule.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { WEEKDAYS, cronFromWeekly, parseWeeklyCron } from "./schedule";

describe("schedule cron helpers", () => {
  it("WEEKDAYS lists Mon..Sun with cron day-of-week numbers", () => {
    expect(WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(WEEKDAYS[0].label).toBe("Mon");
  });

  it("builds a weekly cron from weekdays + time", () => {
    expect(cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 }))
      .toBe("0 10 * * 1,2,3,4,5");
    expect(cronFromWeekly({ weekdays: [1], hour: 9, minute: 30 }))
      .toBe("30 9 * * 1");
  });

  it("sorts and dedupes weekdays", () => {
    expect(cronFromWeekly({ weekdays: [5, 1, 1, 3], hour: 8, minute: 5 }))
      .toBe("5 8 * * 1,3,5");
  });

  it("parses a comma-list cron back to schedule", () => {
    expect(parseWeeklyCron("0 10 * * 1,2,3,4,5"))
      .toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
  });

  it("parses a range cron (e.g. the seed) too", () => {
    expect(parseWeeklyCron("0 10 * * 1-5"))
      .toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
  });

  it("round-trips", () => {
    const s = { weekdays: [1, 3, 5], hour: 14, minute: 15 };
    expect(parseWeeklyCron(cronFromWeekly(s))).toEqual({ minute: 15, hour: 14, weekdays: [1, 3, 5] });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`./schedule` missing).
Run: `pnpm vitest run packages/shared/src/schedule.test.ts` — paste the failure.

- [ ] **Step 3: Implement** — `packages/shared/src/schedule.ts`
```ts
export const WEEKDAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
] as const;

export interface WeeklySchedule {
  weekdays: number[]; // cron day-of-week numbers (0=Sun..6=Sat)
  hour: number;       // 0-23
  minute: number;     // 0-59
}

export function cronFromWeekly({ weekdays, hour, minute }: WeeklySchedule): string {
  const dows = [...new Set(weekdays)].sort((a, b) => a - b).join(",");
  return `${minute} ${hour} * * ${dows}`;
}

export function parseWeeklyCron(cron: string): WeeklySchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) throw new Error(`Unparseable cron: ${cron}`);
  const [m, h, , , dow] = parts;
  const weekdays: number[] = [];
  for (const token of dow.split(",")) {
    if (token.includes("-")) {
      const [a, b] = token.split("-").map(Number);
      for (let i = a; i <= b; i++) weekdays.push(i);
    } else {
      weekdays.push(Number(token));
    }
  }
  return {
    minute: Number(m),
    hour: Number(h),
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
  };
}
```
Add `export * from "./schedule";` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run → PASS** (6 assertions across the cases). Paste.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/schedule.ts packages/shared/src/schedule.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): weekly schedule <-> cron helpers (TDD)"
```

---

### Task 2: Standup data-access (TDD)

**Files:**
- Create: `apps/web/lib/standups.ts`
- Test: `apps/web/lib/standups.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/web/lib/standups.test.ts`
```ts
import { describe, it, expect, afterAll } from "vitest";
import { getStandup, upsertStandup } from "./standups";
import { createTeam } from "./teams";
import { sql } from "./db";
import { DEFAULT_QUESTIONS } from "@poddaily/shared";

const CHAN = "C_TEST_STANDUP";
let teamId: string;

afterAll(async () => {
  await sql`delete from standups where team_id = ${teamId}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("standup data access", () => {
  it("returns undefined when a team has no standup", async () => {
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const team = await createTeam({ name: "Cfg Pod", slackChannelId: CHAN, slackChannelName: "cfg-pod" });
    teamId = team.id;
    expect(await getStandup(teamId)).toBeUndefined();
  });

  it("creates a standup on first upsert", async () => {
    const s = await upsertStandup(teamId, {
      questions: DEFAULT_QUESTIONS,
      scheduleCron: "0 10 * * 1,2,3,4,5",
      scheduleTz: "America/Mexico_City",
      introMessage: "Hi!",
      outroMessage: "Thanks!",
    });
    expect(s.scheduleCron).toBe("0 10 * * 1,2,3,4,5");
    const got = await getStandup(teamId);
    expect(got?.introMessage).toBe("Hi!");
    expect((got?.questions as { text: string }[]).length).toBe(4);
  });

  it("updates the same standup on second upsert (one per team)", async () => {
    await upsertStandup(teamId, {
      questions: [{ id: "q1", text: "Only one?", type: "text" }],
      scheduleCron: "30 9 * * 1",
      scheduleTz: "Europe/London",
      introMessage: "Hello",
      outroMessage: "Bye",
    });
    const got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("30 9 * * 1");
    expect((got?.questions as unknown[]).length).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from standups where team_id = ${teamId}`;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`./standups` missing). Paste.

- [ ] **Step 3: Implement** — `apps/web/lib/standups.ts`
```ts
import { eq, schema } from "@poddaily/db";
import type { Standup } from "@poddaily/db/schema";
import type { Question } from "@poddaily/shared";
import { db } from "./db";

export interface StandupConfig {
  name?: string;
  questions: Question[];
  scheduleCron: string;
  scheduleTz: string;
  introMessage: string;
  outroMessage: string;
}

export async function getStandup(teamId: string): Promise<Standup | undefined> {
  const [s] = await db.select().from(schema.standups).where(eq(schema.standups.teamId, teamId));
  return s;
}

export async function upsertStandup(teamId: string, config: StandupConfig): Promise<Standup> {
  const values = {
    teamId,
    name: config.name ?? "Daily Standup",
    questions: config.questions,
    scheduleCron: config.scheduleCron,
    scheduleTz: config.scheduleTz,
    introMessage: config.introMessage,
    outroMessage: config.outroMessage,
    updatedAt: new Date(),
  };
  const [s] = await db
    .insert(schema.standups)
    .values(values)
    .onConflictDoUpdate({ target: schema.standups.teamId, set: values })
    .returning();
  return s;
}
```

- [ ] **Step 4: Run → PASS** (3 tests). Paste.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/standups.ts apps/web/lib/standups.test.ts
git commit -m "feat(web): standup config data-access with upsert (TDD)"
```

---

### Task 3: Question editor component

**Files:**
- Create: `apps/web/components/standups/question-editor.tsx`

- [ ] **Step 1: Implement** — client component managing a questions array (add / remove / move up-down / inline edit). Semantic classes only.
```tsx
"use client";
import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import type { Question } from "@poddaily/shared";

export function QuestionEditor({ initial, name }: { initial: Question[]; name: string }) {
  const [items, setItems] = useState<Question[]>(initial);

  const update = (i: number, text: string) =>
    setItems((xs) => xs.map((q, j) => (j === i ? { ...q, text } : q)));
  const remove = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = () =>
    setItems((xs) => [...xs, { id: `q${Date.now()}-${xs.length}`, text: "", type: "text" }]);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} readOnly />
      {items.map((q, i) => (
        <div key={q.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
          <input
            value={q.text}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Question text"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="button" aria-label="move up" onClick={() => move(i, -1)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" aria-label="move down" onClick={() => move(i, 1)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" aria-label="remove" onClick={() => remove(i)} className="rounded p-1.5 text-danger hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
        <Plus className="h-4 w-4" /> Add question
      </button>
    </div>
  );
}
```
Note: `{last_report_date}` is a literal allowed in question text (interpolated by the bot later) — no special handling needed here.

- [ ] **Step 2: Verify** the component typechecks (it's exercised by build in Task 5). No commit yet — committed with the form in Task 5. (If you prefer an isolated commit, `git add` + commit it now; either is fine. Recommended: commit now.)
```bash
git add apps/web/components/standups/question-editor.tsx
git commit -m "feat(web): standup question editor (add/remove/reorder/edit)"
```

---

### Task 4: Schedule picker component

**Files:**
- Create: `apps/web/components/standups/schedule-picker.tsx`

- [ ] **Step 1: Implement** — client component: weekday toggles + time + timezone. Emits hidden inputs the Server Action reads.
```tsx
"use client";
import { useState } from "react";
import { WEEKDAYS, COMMON_TIMEZONES } from "@poddaily/shared";

export function SchedulePicker({
  initialWeekdays, initialHour, initialMinute, initialTz,
}: {
  initialWeekdays: number[]; initialHour: number; initialMinute: number; initialTz: string;
}) {
  const [days, setDays] = useState<number[]>(initialWeekdays);
  const time = `${String(initialHour).padStart(2, "0")}:${String(initialMinute).padStart(2, "0")}`;

  const toggle = (v: number) =>
    setDays((xs) => (xs.includes(v) ? xs.filter((d) => d !== v) : [...xs, v]));

  return (
    <div className="space-y-4">
      <input type="hidden" name="weekdays" value={days.join(",")} readOnly />
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.value);
          return (
            <button key={d.value} type="button" onClick={() => toggle(d.value)}
              className={`h-9 w-12 rounded-lg border text-[13px] font-medium ${on ? "border-accent bg-accent-subtle text-accent" : "border-input bg-background text-muted-foreground hover:bg-muted"}`}>
              {d.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Time</span>
          <input type="time" name="time" defaultValue={time} className="h-9 w-32 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Default timezone</span>
          <select name="scheduleTz" defaultValue={initialTz} className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
            {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/web/components/standups/schedule-picker.tsx
git commit -m "feat(web): standup schedule picker (weekdays + time + tz)"
```

---

### Task 5: Standup form + config page + Server Action

**Files:**
- Create: `apps/web/components/standups/standup-form.tsx`, `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`
- Modify: `apps/web/app/(dashboard)/teams/[id]/page.tsx` (add a "Configure standup" link)

- [ ] **Step 1: Standup form (client)** — `apps/web/components/standups/standup-form.tsx`
```tsx
"use client";
import { Button } from "@/components/ui/button";
import { QuestionEditor } from "./question-editor";
import { SchedulePicker } from "./schedule-picker";
import type { Question } from "@poddaily/shared";

export function StandupForm({
  action, questions, weekdays, hour, minute, tz, introMessage, outroMessage,
}: {
  action: (fd: FormData) => void | Promise<void>;
  questions: Question[]; weekdays: number[]; hour: number; minute: number; tz: string;
  introMessage: string; outroMessage: string;
}) {
  return (
    <form action={action} className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Questions</h2>
        <QuestionEditor initial={questions} name="questions" />
      </section>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Schedule</h2>
        <SchedulePicker initialWeekdays={weekdays} initialHour={hour} initialMinute={minute} initialTz={tz} />
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Intro message</span>
          <textarea name="introMessage" defaultValue={introMessage} rows={3} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Outro message</span>
          <textarea name="outroMessage" defaultValue={outroMessage} rows={3} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </section>
      <div className="flex justify-end"><Button type="submit">Save standup</Button></div>
    </form>
  );
}
```

- [ ] **Step 2: Config page + Server Action** — `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`
```tsx
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTeam } from "@/lib/teams";
import { getStandup, upsertStandup } from "@/lib/standups";
import { PageHeader } from "@/components/page-header";
import { StandupForm } from "@/components/standups/standup-form";
import { DEFAULT_QUESTIONS, cronFromWeekly, parseWeeklyCron, type Question } from "@poddaily/shared";

export default async function StandupConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const standup = await getStandup(id);

  const questions = (standup?.questions as Question[] | undefined) ?? DEFAULT_QUESTIONS;
  const { weekdays, hour, minute } = standup
    ? parseWeeklyCron(standup.scheduleCron)
    : { weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 };
  const tz = standup?.scheduleTz ?? "America/Mexico_City";
  const introMessage = standup?.introMessage ?? "Hi! Time for Daily Standup.";
  const outroMessage = standup?.outroMessage ?? "Thanks for your update!";

  async function saveAction(fd: FormData) {
    "use server";
    const parsedQuestions = JSON.parse(String(fd.get("questions") ?? "[]")) as Question[];
    const cleaned = parsedQuestions.map((q) => ({ ...q, text: q.text.trim() })).filter((q) => q.text.length > 0);
    const weekdayNums = String(fd.get("weekdays") ?? "")
      .split(",").filter(Boolean).map(Number);
    const [h, m] = String(fd.get("time") ?? "10:00").split(":").map(Number);
    if (cleaned.length === 0) throw new Error("At least one question is required");
    if (weekdayNums.length === 0) throw new Error("Pick at least one weekday");
    await upsertStandup(id, {
      questions: cleaned,
      scheduleCron: cronFromWeekly({ weekdays: weekdayNums, hour: h, minute: m }),
      scheduleTz: String(fd.get("scheduleTz") ?? "America/Mexico_City"),
      introMessage: String(fd.get("introMessage") ?? ""),
      outroMessage: String(fd.get("outroMessage") ?? ""),
    });
    revalidatePath(`/teams/${id}/standup`);
    redirect(`/teams/${id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`${team.name} · Standup`} />
      <StandupForm
        action={saveAction}
        questions={questions}
        weekdays={weekdays} hour={hour} minute={minute} tz={tz}
        introMessage={introMessage} outroMessage={outroMessage}
      />
    </div>
  );
}
```

- [ ] **Step 3: Link from team detail** — in `apps/web/app/(dashboard)/teams/[id]/page.tsx`, add near the PageHeader a link to the standup config. Add to the `PageHeader` actions or below the channel line:
```tsx
import Link from "next/link";
// ...in the returned JSX, after the channel/tribe line:
<Link href={`/teams/${id}/standup`} className="text-[13px] font-medium text-accent hover:underline">Configure standup →</Link>
```
Preserve the rest of the page exactly.

- [ ] **Step 4: Verify** — `pnpm --filter @poddaily/web build` (with `DATABASE_URL` set via `apps/web/.env.local`). Expect success.

- [ ] **Step 5: Commit**
```bash
git add apps/web/components/standups/standup-form.tsx "apps/web/app/(dashboard)/teams/[id]/standup/page.tsx" "apps/web/app/(dashboard)/teams/[id]/page.tsx"
git commit -m "feat(web): standup config page + form + save action; link from team detail"
```

---

### Task 6: `smoke:config` end-to-end check

**Files:**
- Create: `apps/web/tests/config-smoke.test.ts`
- Modify: root `package.json`

- [ ] **Step 1: Smoke test** — `apps/web/tests/config-smoke.test.ts`

Exercises the same path the Server Action uses: build cron from a weekly schedule, upsert config, re-read, then update.
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createTeam } from "../lib/teams";
import { getStandup, upsertStandup } from "../lib/standups";
import { sql } from "../lib/db";
import { DEFAULT_QUESTIONS, cronFromWeekly, parseWeeklyCron } from "@poddaily/shared";

const CHAN = "C_SMOKE_CONFIG";
let teamId: string;
afterAll(async () => {
  await sql`delete from standups where team_id = ${teamId}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("smoke:config", () => {
  it("configures a standup end to end and updates it", async () => {
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const team = await createTeam({ name: "Config Smoke", slackChannelId: CHAN, slackChannelName: "config-smoke" });
    teamId = team.id;
    expect(await getStandup(teamId)).toBeUndefined();

    const cron = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 });
    await upsertStandup(teamId, {
      questions: DEFAULT_QUESTIONS, scheduleCron: cron, scheduleTz: "America/Mexico_City",
      introMessage: "Hi!", outroMessage: "Thanks!",
    });
    let got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("0 10 * * 1,2,3,4,5");
    expect(parseWeeklyCron(got!.scheduleCron)).toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
    expect((got?.questions as unknown[]).length).toBe(4);

    await upsertStandup(teamId, {
      questions: [{ id: "q1", text: "What's blocking you?", type: "text" }],
      scheduleCron: cronFromWeekly({ weekdays: [1], hour: 9, minute: 30 }),
      scheduleTz: "Europe/London", introMessage: "Morning", outroMessage: "Done",
    });
    got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("30 9 * * 1");
    expect(got?.scheduleTz).toBe("Europe/London");
    expect((got?.questions as unknown[]).length).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from standups where team_id = ${teamId}`;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run → PASS**
Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm vitest run apps/web/tests/config-smoke.test.ts` — paste.

- [ ] **Step 3: Add `smoke:config` script** to root `package.json` (keep existing):
```json
"smoke:config": "vitest run apps/web/tests/config-smoke.test.ts apps/web/lib/standups.test.ts packages/shared/src/schedule.test.ts"
```

- [ ] **Step 4: Run via script** — `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm smoke:config` → all pass. Paste.

- [ ] **Step 5: Commit**
```bash
git add apps/web/tests/config-smoke.test.ts package.json
git commit -m "test(web): smoke:config — standup configuration end-to-end"
```

---

### Task 7: Definition-of-done updates (docs)

**Files:**
- Modify: `README.md`, `ContextDB/00_index/project-map.md`
- Create: `ContextDB/08_logs/2026-06-17-step4-standup-config-build.md`

- [ ] **Step 1: Tick README** — change `- [ ] Standup configuration (questions, schedule, intro/outro)` → `- [x] ...`.

- [ ] **Step 2: Project map** — mark Step 4 done, queue Step 5.

- [ ] **Step 3: Full suite** — `export DATABASE_URL=...; pnpm test` (all green incl. new) and `pnpm --filter @poddaily/web build`.

- [ ] **Step 4: Build log** — `ContextDB/08_logs/2026-06-17-step4-standup-config-build.md`
```markdown
# 2026-06-17 — Step 4 Build: Standup Configuration

Added standup config: schedule↔cron helpers in @poddaily/shared (TDD), a standups
data-access layer with upsert (one standup per team), and a /teams/[id]/standup page with a
question editor (add/remove/reorder/inline-edit), a schedule picker (weekdays + time + tz),
and intro/outro messages — saved via a Server Action. smoke:config green.

## Verification
- pnpm test: all green (added schedule + standups + config-smoke tests).
- pnpm smoke:config: green.
- pnpm --filter @poddaily/web build: success.

## Scope notes
- Reorder is up/down controls (drag-and-drop is later polish).
- smoke:config verifies config persistence; registering the BullMQ repeatable job is Step 5
  (the scheduler doesn't exist yet).

Next: build-order step 5 — scheduler + send-standup-dm + DM Q&A engine (apps/api + apps/worker, smoke:standup).
```

- [ ] **Step 5: Commit**
```bash
git add README.md ContextDB
git commit -m "docs: step 4 build log + README/project-map (standup config shipped)"
```

---

## Verification (end of Step 4)

- [ ] `pnpm smoke:config` passes (schedule helpers + standups data-access + end-to-end).
- [ ] `pnpm test` passes (all suites).
- [ ] `pnpm --filter @poddaily/web build` succeeds.
- [ ] Configuring a standup persists questions + cron + tz + messages; re-opening shows them; one standup per team (upsert).
- [ ] All UI uses semantic theme classes (reskinnable).

This produces standup configuration — the base for Step 5 (the scheduler + Slack DM engine).
