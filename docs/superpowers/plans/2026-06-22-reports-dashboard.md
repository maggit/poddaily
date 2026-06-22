# Reports Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can view standups in the web app — a "today across all teams" overview (`/reports`) and a per-team feed of per-person check-in cards (avatar + status + answers) with history browsing (`/reports/[teamId]`) — with real Slack avatars fetched via `users.info`.

**Architecture:** Read-only Server-Component data-access in `apps/web/lib/reports.ts` (no REST). Answers interpolate `{last_report_date}` at render via the existing `lastReportDateBefore` + `interpolateLastReportDate`. Avatars come from a new `slack-client.getUserProfile` (wraps `users.info`), populated on member-add + a one-off backfill, stored in the existing `team_members.slack_avatar_url`. Reuses the design system (`DataTable`, `StatusPill`, `PageHeader`); adds an avatar + report-card component.

**Tech Stack:** Next.js 15 App Router (Server Components), Drizzle + postgres-js (`@poddaily/db`), `@slack/web-api` via `@poddaily/slack-client`, Vitest, the `tools/slack-stub`.

Source: [Reports Dashboard spec](../specs/2026-06-22-reports-dashboard-design.md).

> **Scope notes:** read-only dashboard (only writes are avatar enrichment); no new schema (`slack_avatar_url` exists, unpopulated); no REST API; needs the bot `users:read` scope; `SLACK_BOT_TOKEN` already on web. NOT building integration rows / reactions / comments / AI highlights.

---

## File Structure

```
tools/slack-stub/src/server.ts (+ test)                 # fake users.info
packages/slack-client/src/index.ts (+ test)             # getUserProfile
apps/web/lib/teams.ts (+ test)                           # setMemberAvatar, listMembersMissingAvatar
apps/web/app/(dashboard)/teams/[id]/page.tsx             # fetch avatar on add + "View reports →" link
apps/web/scripts/backfill-avatars.ts                     # one-off backfill
apps/web/lib/reports.ts (+ test)                         # getTodayOverview / getRunDetail / listTeamRunDates
apps/web/components/ui/avatar.tsx                         # img-or-initials avatar
apps/web/components/reports/report-card.tsx              # per-member check-in card
apps/web/app/(dashboard)/reports/page.tsx               # today overview
apps/web/app/(dashboard)/reports/[teamId]/page.tsx      # card feed + history
README.md · ContextDB/* · build log                      # DoD
```

---

### Task 1: Slack stub — fake `users.info`

**Files:** Modify `tools/slack-stub/src/server.ts`; Test `tools/slack-stub/src/server.test.ts`.

- [ ] **Step 1: READ** `tools/slack-stub/src/server.ts` — confirm `readBody`, `json`, and the existing `/api/*` handlers' style.

- [ ] **Step 2: Add the `users.info` fake** near the other `/api/*` routes:

```ts
    if (u.pathname === "/api/users.info") {
      const body = await readBody(req);
      const user = body.get("user") || "U_STUB";
      return json(200, {
        ok: true,
        user: {
          id: user,
          real_name: "Stub User",
          tz: "America/New_York",
          profile: { image_192: `https://stub.local/${user}-192.png`, image_512: `https://stub.local/${user}-512.png` },
        },
      });
    }
```

- [ ] **Step 3: Add a stub test** — append to `tools/slack-stub/src/server.test.ts` (match the file's style; it uses a shared `stub` + `postForm` or direct fetch):

```ts
it("fakes users.info with a profile image, tz and real_name", async () => {
  const res = await (await fetch(`${stub.url}/api/users.info`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user: "U123" }),
  })).json();
  expect(res).toMatchObject({ ok: true, user: { id: "U123", tz: "America/New_York", real_name: "Stub User" } });
  expect(res.user.profile.image_512).toContain("U123");
});
```
(If the file uses a module-scoped `stub` from `beforeAll`, reuse it.)

- [ ] **Step 4: Run from repo root, confirm PASS:** `pnpm exec vitest run tools/slack-stub/src/server.test.ts`

- [ ] **Step 5: Commit**

```bash
git add tools/slack-stub/src/server.ts tools/slack-stub/src/server.test.ts
git commit -m "test(slack-stub): fake users.info

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `slack-client.getUserProfile`

**Files:** Modify `packages/slack-client/src/index.ts`; Test `packages/slack-client/src/index.test.ts`.

- [ ] **Step 1: READ** `packages/slack-client/src/index.ts` (the `SlackClient` interface + `createSlackClient`) and `index.test.ts` (how it points at the stub).

- [ ] **Step 2: Write the failing test** — add to `packages/slack-client/src/index.test.ts` (reuse the file's stub setup):

```ts
it("getUserProfile returns image / tz / realName from users.info", async () => {
  const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
  const p = await client.getUserProfile("U777");
  expect(p.image).toContain("U777");
  expect(p.tz).toBe("America/New_York");
  expect(p.realName).toBe("Stub User");
});
```

- [ ] **Step 3: Run from repo root, confirm FAIL** (`getUserProfile` undefined).

- [ ] **Step 4: Implement** — add to the `SlackClient` interface:

```ts
  /** Fetch a user's Slack profile (users.info). Needs the bot `users:read` scope. */
  getUserProfile(slackUserId: string): Promise<{ image: string | null; tz: string | null; realName: string | null }>;
```
and to the returned object in `createSlackClient`:

```ts
    async getUserProfile(slackUserId) {
      const res = await web.users.info({ user: slackUserId });
      const u = res.user as
        | { real_name?: string; tz?: string; profile?: { image_192?: string; image_512?: string } }
        | undefined;
      return {
        image: u?.profile?.image_512 ?? u?.profile?.image_192 ?? null,
        tz: u?.tz ?? null,
        realName: u?.real_name ?? null,
      };
    },
```

- [ ] **Step 5: Run from repo root, confirm PASS.** Type-check: the package has no local tsconfig — type-check via the repo base config (as the slack-client `updateMessage` task did) or skip if the test + `pnpm test` pass.

- [ ] **Step 6: Commit**

```bash
git add packages/slack-client/src/index.ts packages/slack-client/src/index.test.ts
git commit -m "feat(slack-client): getUserProfile (users.info)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Avatar persistence + member-add fetch + backfill

**Files:** Modify `apps/web/lib/teams.ts`; Test `apps/web/lib/teams.test.ts`; Modify `apps/web/app/(dashboard)/teams/[id]/page.tsx`; Create `apps/web/scripts/backfill-avatars.ts`; Modify `apps/web/package.json`.

- [ ] **Step 1: Write the failing test** — add to `apps/web/lib/teams.test.ts` (READ it for the seed/cleanup helpers + constants):

```ts
it("setMemberAvatar persists the avatar url", async () => {
  const team = await createTeam({ name: "Av Pod", slackChannelId: "C_AV", slackChannelName: "av" });
  const m = await addMember(team.id, { slackUserId: "U_AV", slackDisplayName: "Av", timezone: "UTC", canReport: true, canView: true, canEdit: false });
  expect(m.slackAvatarUrl).toBeNull();
  await setMemberAvatar(m.id, "https://x/av.png");
  const [row] = await listMembers(team.id);
  expect(row.slackAvatarUrl).toBe("https://x/av.png");
  // listMembersMissingAvatar should no longer include this member
  const missing = await listMembersMissingAvatar();
  expect(missing.find((x) => x.id === m.id)).toBeUndefined();
});
```
(Import `setMemberAvatar`, `listMembersMissingAvatar` from `./teams`. Add cleanup for `C_AV`/`U_AV` to the file's teardown.)

- [ ] **Step 2: Run from repo root, confirm FAIL.**

- [ ] **Step 3: Implement** — add to `apps/web/lib/teams.ts`:

```ts
export async function setMemberAvatar(memberId: string, avatarUrl: string): Promise<void> {
  await db.update(schema.teamMembers).set({ slackAvatarUrl: avatarUrl }).where(eq(schema.teamMembers.id, memberId));
}

/** Members with no avatar yet — for the one-off backfill. */
export function listMembersMissingAvatar(): Promise<{ id: string; slackUserId: string }[]> {
  return db
    .select({ id: schema.teamMembers.id, slackUserId: schema.teamMembers.slackUserId })
    .from(schema.teamMembers)
    .where(isNull(schema.teamMembers.slackAvatarUrl));
}
```
Update the import to include `isNull`: `import { eq, isNull, schema } from "@poddaily/db";` — confirm `@poddaily/db` re-exports `isNull` (it re-exports `eq, and, or, not, inArray, desc, asc, sql`; if `isNull` is NOT exported, import it from `drizzle-orm` directly: `import { isNull } from "drizzle-orm";`). Use whichever resolves.

- [ ] **Step 4: Run from repo root, confirm PASS.**

- [ ] **Step 5: Fetch the avatar on member-add** — in `apps/web/app/(dashboard)/teams/[id]/page.tsx`, the `addMemberAction` currently calls `addMember(...)`. After it, best-effort fetch + set the avatar:

```ts
import { createSlackClient } from "@poddaily/slack-client";
import { getTeam, listMembers, addMember, setMemberPermissions, removeMember, setMemberAvatar } from "@/lib/teams";
// ...inside addMemberAction, after addMember:
    const member = await addMember(id, { slackUserId, slackDisplayName, timezone, canReport: true, canView: true, canEdit: false });
    try {
      const profile = await createSlackClient().getUserProfile(slackUserId);
      if (profile.image) await setMemberAvatar(member.id, profile.image);
    } catch (err) {
      console.warn(`[avatar] fetch failed for ${slackUserId}:`, (err as Error).message);
    }
    revalidatePath(`/teams/${id}`);
```
(Best-effort — a Slack failure must not block adding the member. `createSlackClient()` reads `SLACK_BOT_TOKEN`/`SLACK_API_BASE_URL` from env.)

- [ ] **Step 6: Add a "View reports →" link** to the same page, near the "Configure standup →" link:

```tsx
      <div className="flex gap-4">
        <Link href={`/teams/${id}/standup`} className="text-[13px] font-medium text-accent hover:underline">Configure standup →</Link>
        <Link href={`/reports/${id}`} className="text-[13px] font-medium text-accent hover:underline">View reports →</Link>
      </div>
```
(Replace the existing single `Configure standup →` Link with this row.)

- [ ] **Step 7: Backfill script** — create `apps/web/scripts/backfill-avatars.ts`:

```ts
import { createSlackClient } from "@poddaily/slack-client";
import { listMembersMissingAvatar, setMemberAvatar } from "../lib/teams";
import { sql } from "../lib/db";

async function main() {
  const slack = createSlackClient();
  const members = await listMembersMissingAvatar();
  console.log(`[backfill] ${members.length} member(s) missing an avatar`);
  for (const m of members) {
    try {
      const p = await slack.getUserProfile(m.slackUserId);
      if (p.image) {
        await setMemberAvatar(m.id, p.image);
        console.log(`[backfill] set avatar for ${m.slackUserId}`);
      } else {
        console.log(`[backfill] no image for ${m.slackUserId}`);
      }
    } catch (err) {
      console.warn(`[backfill] failed for ${m.slackUserId}:`, (err as Error).message);
    }
  }
  await sql.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
```
Add a script to `apps/web/package.json` `"scripts"`: `"backfill:avatars": "tsx scripts/backfill-avatars.ts"`. (Confirm `tsx` is available to `apps/web` — if not, add it as a devDep; the worker/api use `tsx`.)

- [ ] **Step 8: Type-check the web app** (catch import issues): `pnpm --filter @poddaily/web exec tsc --noEmit` — expected clean. Run the teams test again: `pnpm exec vitest run apps/web/lib/teams.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/teams.ts apps/web/lib/teams.test.ts apps/web/app/\(dashboard\)/teams/\[id\]/page.tsx apps/web/scripts/backfill-avatars.ts apps/web/package.json
git commit -m "feat(web): fetch Slack avatars on member add + backfill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `lib/reports.ts` — data-access (integration TDD)

**Files:** Create `apps/web/lib/reports.ts`; Test `apps/web/lib/reports.test.ts`.

- [ ] **Step 1: Write the failing test** — `apps/web/lib/reports.test.ts` (mirrors `standups.test.ts`; real Postgres):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "./db";
import { getTodayOverview, getRunDetail, listTeamRunDates } from "./reports";

const CHAN = "C_REPORTS_TEST";
let teamId = "";
let standupId = "";
let todayRunId = "";

async function cleanup() {
  await sql`delete from standup_reports where run_id in (select id from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})))`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Reports Pod', ${CHAN}, 'rep') returning id`;
  teamId = team.id;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${teamId}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Since {last_report_date}?", type: "text" }, { id: "q2", text: "Today?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  // members: A reports, B times out, C absent (no report row)
  for (const u of ["U_A", "U_B", "U_C"]) {
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report, slack_avatar_url) values (${teamId}, ${u}, ${"Member " + u}, 'UTC', true, ${u === "U_A" ? "https://x/a.png" : null})`;
  }
  // a PRIOR completed report for A (for {last_report_date} interpolation)
  const [prevRun] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, '2026-06-20T10:00:00Z', '2026-06-20', 'completed') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, reported_at, created_at) values (${prevRun.id}, 'U_A', 'Member U_A', ${JSON.stringify([])}, 'completed', '2026-06-20T10:00:00Z', '2026-06-20T10:00:00Z')`;
  // TODAY's run
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'running') returning id`;
  todayRunId = run.id;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${todayRunId}, 'U_A', 'Member U_A', ${JSON.stringify([{ questionId: "q1", questionText: "Since {last_report_date}?", answer: "shipped" }, { questionId: "q2", questionText: "Today?", answer: "more" }])}, 'completed')`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${todayRunId}, 'U_B', 'Member U_B', ${JSON.stringify([])}, 'timed_out')`;
  // U_C has no report row → absent
});
afterAll(async () => { await cleanup(); await sql.end(); });

describe("getTodayOverview", () => {
  it("lists today's run with participation counts", async () => {
    const rows = await getTodayOverview();
    const row = rows.find((r) => r.teamId === teamId);
    expect(row).toBeTruthy();
    expect(row!.run?.status).toBe("running");
    expect(row!.total).toBe(2);     // A + B have report rows today
    expect(row!.reported).toBe(1);  // only A completed
  });
});

describe("getRunDetail", () => {
  it("returns a card per can_report member with statuses + interpolated answers", async () => {
    const detail = await getRunDetail(teamId);
    expect(detail).toBeTruthy();
    expect(detail!.run?.scheduledDate).toBeTruthy();
    const cards = detail!.cards;
    expect(cards.map((c) => c.slackUserId).sort()).toEqual(["U_A", "U_B", "U_C"]);
    const a = cards.find((c) => c.slackUserId === "U_A")!;
    expect(a.status).toBe("completed");
    expect(a.avatarUrl).toBe("https://x/a.png");
    expect(a.answers[0].question).not.toContain("{last_report_date}"); // interpolated
    expect(a.answers[0].question).toContain("Jun 20");
    expect(cards.find((c) => c.slackUserId === "U_B")!.status).toBe("timed_out");
    expect(cards.find((c) => c.slackUserId === "U_C")!.status).toBe("absent");
  });
  it("returns null for an unknown team", async () => {
    expect(await getRunDetail("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("listTeamRunDates", () => {
  it("lists recent runs newest-first with counts", async () => {
    const dates = await listTeamRunDates(teamId);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(new Date(dates[0].date) >= new Date(dates[1].date)).toBe(true); // desc
  });
});
```

- [ ] **Step 2: Run from repo root, confirm FAIL** (module not found).

- [ ] **Step 3: Implement** — `apps/web/lib/reports.ts`:

```ts
import { eq, and, desc, lastReportDateBefore, schema } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import { db, sql } from "./db";

export interface OverviewRow {
  teamId: string; teamName: string; slackChannelName: string; standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  reported: number; total: number;
}

/** One row per active standup: today's run (scheduled_date = current_date) + participation. */
export async function getTodayOverview(): Promise<OverviewRow[]> {
  const rows = await sql<Array<{
    team_id: string; team_name: string; slack_channel_name: string; standup_name: string;
    run_id: string | null; run_date: string | null; run_status: string | null;
    total: number; reported: number;
  }>>`
    select s.team_id, t.name as team_name, t.slack_channel_name, s.name as standup_name,
           r.id as run_id, r.scheduled_date::text as run_date, r.status as run_status,
           count(rep.id)::int as total,
           count(rep.id) filter (where rep.status = 'completed')::int as reported
    from standups s
    join teams t on t.id = s.team_id
    left join standup_runs r on r.standup_id = s.id and r.scheduled_date = current_date
    left join standup_reports rep on rep.run_id = r.id
    where s.is_active = true
    group by s.team_id, t.name, t.slack_channel_name, s.name, r.id, r.scheduled_date, r.status
    order by t.name`;
  return rows.map((x) => ({
    teamId: x.team_id, teamName: x.team_name, slackChannelName: x.slack_channel_name, standupName: x.standup_name,
    run: x.run_id ? { id: x.run_id, scheduledDate: x.run_date as string, status: x.run_status ?? "running" } : null,
    reported: x.reported, total: x.total,
  }));
}

export interface ReportCard {
  slackUserId: string; displayName: string; avatarUrl: string | null;
  status: "completed" | "in_progress" | "timed_out" | "absent";
  answers: { question: string; answer: string }[];
  reportedAt: Date | null;
}
export interface RunDetail {
  team: { id: string; name: string; slackChannelName: string };
  standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  cards: ReportCard[]; reported: number; total: number;
}

/** A team's run for `date` (default = latest), with each can_report member's card. Null = unknown team. */
export async function getRunDetail(teamId: string, date?: string): Promise<RunDetail | null> {
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
  if (!team) return null;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.teamId, teamId));

  let run: typeof schema.standupRuns.$inferSelect | undefined;
  if (standup) {
    const where = date
      ? and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, date))
      : eq(schema.standupRuns.standupId, standup.id);
    [run] = await db.select().from(schema.standupRuns).where(where).orderBy(desc(schema.standupRuns.scheduledDate)).limit(1);
  }

  const members = await db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.canReport, true)))
    .orderBy(schema.teamMembers.slackDisplayName);
  const reports = run
    ? await db.select().from(schema.standupReports).where(eq(schema.standupReports.runId, run.id))
    : [];
  const byUser = new Map(reports.map((r) => [r.slackUserId, r]));

  const cards: ReportCard[] = await Promise.all(members.map(async (m) => {
    const rep = byUser.get(m.slackUserId);
    if (!rep) {
      return { slackUserId: m.slackUserId, displayName: m.slackDisplayName, avatarUrl: m.slackAvatarUrl, status: "absent", answers: [], reportedAt: null };
    }
    let answers: { question: string; answer: string }[] = [];
    if (rep.status === "completed") {
      const lastDate = await lastReportDateBefore(db, m.slackUserId, rep.createdAt ?? new Date());
      answers = rep.answers.map((a) => ({ question: interpolateLastReportDate(a.questionText, lastDate), answer: a.answer }));
    }
    return {
      slackUserId: m.slackUserId, displayName: m.slackDisplayName, avatarUrl: m.slackAvatarUrl,
      status: (rep.status ?? "in_progress") as ReportCard["status"], answers, reportedAt: rep.reportedAt,
    };
  }));

  return {
    team: { id: team.id, name: team.name, slackChannelName: team.slackChannelName },
    standupName: standup?.name ?? "Standup",
    run: run ? { id: run.id, scheduledDate: run.scheduledDate, status: run.status ?? "running" } : null,
    cards,
    total: reports.length,
    reported: reports.filter((r) => r.status === "completed").length,
  };
}

export interface RunDate { date: string; status: string; reported: number; total: number; }

export async function listTeamRunDates(teamId: string, limit = 14): Promise<RunDate[]> {
  const [standup] = await db.select({ id: schema.standups.id }).from(schema.standups).where(eq(schema.standups.teamId, teamId));
  if (!standup) return [];
  const runs = await db.select({ id: schema.standupRuns.id, date: schema.standupRuns.scheduledDate, status: schema.standupRuns.status })
    .from(schema.standupRuns).where(eq(schema.standupRuns.standupId, standup.id))
    .orderBy(desc(schema.standupRuns.scheduledDate)).limit(limit);
  return Promise.all(runs.map(async (r) => {
    const reps = await db.select({ status: schema.standupReports.status }).from(schema.standupReports).where(eq(schema.standupReports.runId, r.id));
    return { date: r.date, status: r.status ?? "running", reported: reps.filter((x) => x.status === "completed").length, total: reps.length };
  }));
}
```
(`lastReportDateBefore` is re-exported from `@poddaily/db`. If `getTodayOverview`'s `run_date` comes back as a `Date` rather than a string in some driver config, the `::text` cast in the SQL forces a string — keep it.)

- [ ] **Step 4: Run from repo root, confirm PASS** (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/reports.ts apps/web/lib/reports.test.ts
git commit -m "feat(web): reports data-access (today overview, run detail, history)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: UI components — avatar + report card

**Files:** Create `apps/web/components/ui/avatar.tsx`, `apps/web/components/reports/report-card.tsx`.

Presentational Server Components; no unit tests (matches the repo's data-access-first test style). They must type-check.

- [ ] **Step 1: `apps/web/components/ui/avatar.tsx`**

```tsx
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-surface-muted text-[11px] font-medium text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}
```
(Plain `<img>` avoids `next/image` remote-domain config.)

- [ ] **Step 2: `apps/web/components/reports/report-card.tsx`**

```tsx
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import type { ReportCard as ReportCardData } from "@/lib/reports";

const STATUS: Record<ReportCardData["status"], { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  completed: { tone: "success", label: "Reported" },
  in_progress: { tone: "neutral", label: "Pending" },
  timed_out: { tone: "danger", label: "Timed out" },
  absent: { tone: "neutral", label: "Yet to report" },
};

export function ReportCard({ card }: { card: ReportCardData }) {
  const s = STATUS[card.status];
  const muted = card.status !== "completed";
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${muted ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <Avatar src={card.avatarUrl} name={card.displayName} />
        <div className="flex-1">
          <div className="font-medium text-foreground">{card.displayName}</div>
          {card.reportedAt ? (
            <div className="text-xs text-subtle-foreground">{new Date(card.reportedAt).toLocaleString()}</div>
          ) : null}
        </div>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
      </div>
      {card.answers.length > 0 ? (
        <dl className="mt-4 space-y-3 border-t border-border pt-4">
          {card.answers.map((qa, i) => (
            <div key={i}>
              <dt className="text-[13px] font-medium text-foreground">{qa.question}</dt>
              <dd className="mt-0.5 text-[13px] text-muted-foreground whitespace-pre-line">{qa.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Type-check the web app:** `pnpm --filter @poddaily/web exec tsc --noEmit` — expected clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/avatar.tsx apps/web/components/reports/report-card.tsx
git commit -m "feat(web): avatar + report-card components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Pages — `/reports` overview + `/reports/[teamId]` feed

**Files:** Create `apps/web/app/(dashboard)/reports/page.tsx`, `apps/web/app/(dashboard)/reports/[teamId]/page.tsx`.

- [ ] **Step 1: `apps/web/app/(dashboard)/reports/page.tsx`** — today overview:

```tsx
import Link from "next/link";
import { getTodayOverview } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

export default async function ReportsPage() {
  const rows = await getTodayOverview();
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No standups configured yet. <Link href="/dashboard" className="text-accent">Go to Teams</Link>.
        </div>
      ) : (
        <DataTable head={<><Th>Team</Th><Th>Standup</Th><Th>Date</Th><Th>Status</Th><Th>Reported</Th><Th /></>}>
          {rows.map((r) => (
            <tr key={r.teamId} className="hover:bg-surface-muted">
              <Td><Link href={`/reports/${r.teamId}`} className="font-medium text-foreground hover:text-accent">{r.teamName}</Link><span className="ml-2 text-subtle-foreground">#{r.slackChannelName}</span></Td>
              <Td className="text-muted-foreground">{r.standupName}</Td>
              <Td className="text-muted-foreground">{r.run?.scheduledDate ?? "—"}</Td>
              <Td>{r.run ? <StatusPill tone={r.run.status === "completed" ? "success" : "warning"}>{r.run.status}</StatusPill> : <span className="text-subtle-foreground">No standup today</span>}</Td>
              <Td className="text-muted-foreground">{r.reported}/{r.total}</Td>
              <Td className="text-right"><Link href={`/reports/${r.teamId}`} className="text-accent">View →</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `apps/web/app/(dashboard)/reports/[teamId]/page.tsx`** — card feed + history:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunDetail, listTeamRunDates } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ReportCard } from "@/components/reports/report-card";

export default async function TeamReportsPage({
  params, searchParams,
}: { params: Promise<{ teamId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { teamId } = await params;
  const { date } = await searchParams;
  const detail = await getRunDetail(teamId, date);
  if (!detail) notFound();
  const dates = await listTeamRunDates(teamId);
  const activeDate = detail.run?.scheduledDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${detail.team.name} — Reports`}
        actions={detail.run ? <StatusPill tone={detail.run.status === "completed" ? "success" : "warning"}>{detail.run.status} · {detail.reported}/{detail.total}</StatusPill> : null}
      />
      <Link href={`/teams/${teamId}`} className="text-[13px] text-accent hover:underline">← Back to team</Link>

      {dates.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <Link
              key={d.date}
              href={`/reports/${teamId}?date=${d.date}`}
              className={`rounded-full px-3 py-1 text-xs ${d.date === activeDate ? "bg-accent text-accent-foreground" : "bg-surface-muted text-muted-foreground hover:text-foreground"}`}
            >
              {d.date} · {d.reported}/{d.total}
            </Link>
          ))}
        </div>
      ) : null}

      {!detail.run ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No standup ran{date ? ` on ${date}` : " yet"}.
        </div>
      ) : (
        <div className="space-y-4">
          {detail.cards.map((c) => <ReportCard key={c.slackUserId} card={c} />)}
        </div>
      )}
    </div>
  );
}
```
(If the design tokens `accent-foreground` / `card` aren't defined, substitute the nearest existing token — check `apps/web` Tailwind/theme; the other components use `bg-card`, `text-accent`, `bg-surface-muted`, so those exist. Verify by the page rendering / type-check.)

- [ ] **Step 3: Type-check + build sanity:** `pnpm --filter @poddaily/web exec tsc --noEmit` (clean). Optionally `pnpm --filter @poddaily/web build` if quick, to catch RSC/route errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(dashboard\)/reports/page.tsx apps/web/app/\(dashboard\)/reports/\[teamId\]/page.tsx
git commit -m "feat(web): /reports overview + /reports/[teamId] card feed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Definition-of-done — docs + verify

**Files:** Modify `README.md`, `ContextDB/00_index/getting-started.md`; Create `ContextDB/08_logs/2026-06-22-reports-dashboard.md`.

- [ ] **Step 1: README** — add a feature-checklist item: `- [x] Reports dashboard (today + history, per-person check-in feed with Slack avatars)` (admin-only). Add `users:read` to any documented bot scope list, and note the avatar backfill: `pnpm --filter @poddaily/web backfill:avatars` (run once after deploy). Note Phase 2 sub-project A.

- [ ] **Step 2: `getting-started.md`** — short "Reports dashboard" note: `/reports` shows today across teams; click a team for the per-person feed + history; avatars come from Slack (`users:read`), populated on member-add + the backfill script.

- [ ] **Step 3: Build log** — create `ContextDB/08_logs/2026-06-22-reports-dashboard.md` (follow prior logs): What shipped (slack-stub users.info, slack-client getUserProfile, avatar persistence + member-add fetch + backfill, lib/reports data-access, avatar + report-card components, /reports + /reports/[teamId] pages), Verification (`pnpm test` totals), Notable decisions (card-feed UI; Server-Component data-access, no REST; today=current_date with date label; render-time {last_report_date} interpolation reusing the shared helper; real Slack avatars with initials fallback; out-of-scope: integrations/reactions/highlights), honest DoD (automated green; **live walk pending** — view a real run, confirm avatars + interpolated answers; run the backfill; the `users:read` scope is a human/operator step), and that this is **Phase 2 sub-project A** (B reminders / C admin controls / D RBAC remain).

- [ ] **Step 4: Final verification**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm test`
Expected: all green (the new slack-stub, slack-client, teams, reports tests + existing suites). If anything fails, STOP and report.

- [ ] **Step 5: Commit**

```bash
git add README.md ContextDB/00_index/getting-started.md ContextDB/08_logs/2026-06-22-reports-dashboard.md
git commit -m "docs: Reports dashboard (README, getting-started, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Slack avatar enrichment: stub `users.info` (T1), `getUserProfile` (T2), `setMemberAvatar`/`listMembersMissingAvatar`/member-add fetch/backfill (T3). ✓
- Data-access `getTodayOverview`/`getRunDetail`/`listTeamRunDates` with interpolation (T4). ✓
- Card-feed UI: `Avatar` + `ReportCard` (T5); `/reports` overview + `/reports/[teamId]` feed + history links + "View reports" link (T6). ✓
- today=current_date with date label (T4 SQL `current_date` + the pages show `scheduledDate`). ✓
- Initials fallback (T5 Avatar). ✓ Out-of-scope features not built. ✓
- DoD incl. `users:read` + backfill (T7). ✓

**Placeholder scan:** every code step has complete code; UI steps note "verify the token exists / substitute nearest" only where a Tailwind theme token might differ — the implementer confirms via type-check/render, not a guess at logic. ✓

**Type consistency:** `getUserProfile → { image, tz, realName }` (T2) consumed by T3 (member-add) + the backfill. `ReportCard` interface (T4) consumed by the `ReportCard` component (T5) and the detail page (T6). `OverviewRow`/`RunDetail`/`RunDate` (T4) consumed by the pages (T6). `setMemberAvatar`/`listMembersMissingAvatar` (T3) used by the backfill + member-add. `getRunDetail` returns `RunDetail | null` (T4) and the page calls `notFound()` on null (T6) — consistent. ✓
