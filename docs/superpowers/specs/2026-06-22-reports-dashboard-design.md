# Reports Dashboard Design (Phase 2, sub-project A)

- **Date:** 2026-06-22
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — first sub-project (the deferred P0 "today's dashboard")
- **Predecessor:** Phase 1 Core (feature-complete)

## Summary

Phase 1 built the bot pipeline (running standups); there's still no way to **view** standups in
the admin app. This adds the **Reports Dashboard**: a global "today across all teams" overview
plus a per-team run detail with history browsing. Read-only, Server-Component data-access (no REST
API), reusing the existing design system.

## Scope

**In scope (v1):**
- **Today overview** (`/reports`): every active standup's run for today — participation
  (reported / total), run status, link to detail.
- **Per-team detail + history** (`/reports/[teamId]`): a run's full detail (each member: status +
  inline Q&A answers; non-reporters shown as Pending/Timed-out) with a date selector to browse
  that team's past runs.
- Server-Component data-access in `apps/web/lib/reports.ts` (no REST layer).

**Out of scope (later / P1):** live/real-time updates (server render + Next revalidation on
navigation is fine); CSV/export; charts/analytics; editing from the dashboard; reminders (Phase 2
sub-project B); RBAC gating beyond the existing admin-only `(dashboard)` layout.

## Decisions locked

1. **Today + history**, **global overview + per-team detail**, **Server-Component data-access**
   (the three brainstorm forks).
2. **"Today" = `scheduled_date = current_date`** (the run opened today), and every view **shows
   the run's date label** so near-midnight timezone edges are unambiguous. No per-standup-tz
   "today" logic in v1.
3. **Answers are interpolated at render** — `{last_report_date}` in a stored `questionText` is
   replaced via `interpolateLastReportDate` using `lastReportDateBefore(db, slackUserId,
   report.createdAt)` (the shared helper shipped with the broadcast fix), so the dashboard shows
   the same date the DM + channel post show.
4. **Read-only.** No mutations from the dashboard in v1.

## Architecture & components

### 1. Data-access — `apps/web/lib/reports.ts` (Server Components, over the web `db` singleton)

Mirrors `teams.ts`/`standups.ts`. Three functions:

```ts
export interface OverviewRow {
  teamId: string;
  teamName: string;
  slackChannelName: string;
  standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null; // null = no run today
  reported: number;  // completed reports for the run
  total: number;     // reports fanned out for the run
}
/** One row per active standup: today's run (scheduled_date = current_date) + participation. */
export async function getTodayOverview(): Promise<OverviewRow[]>;

export interface ReportRow {
  slackUserId: string;
  displayName: string;
  status: "completed" | "in_progress" | "timed_out" | "absent";
  answers: { question: string; answer: string }[]; // interpolated; empty unless completed
  reportedAt: Date | null;
  channelPostTs: string | null;
}
export interface RunDetail {
  team: { id: string; name: string; slackChannelName: string };
  standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  rows: ReportRow[];          // one per can_report member: their report (or "absent" if no row)
  reported: number;
  total: number;
}
/** A team's run for `date` (default = latest), with each member's status + interpolated answers. */
export async function getRunDetail(teamId: string, date?: string): Promise<RunDetail>;

export interface RunDate { date: string; status: string; reported: number; total: number; }
/** Recent run dates for a team's history selector (most recent first). */
export async function listTeamRunDates(teamId: string, limit?: number): Promise<RunDate[]>;
```

- `total`/`reported` derive from `standup_reports` for the run (`total` = all rows, `reported` =
  `completed`) — consistent with the broadcast counter.
- `rows` in `getRunDetail`: left-join the team's `can_report` members to the run's reports;
  a member with no report row → `status: "absent"`. Answers are interpolated via
  `lastReportDateBefore` + `interpolateLastReportDate` per row.
- All read-only `select`s; no schema changes.

### 2. Pages — App Router, under the existing `(dashboard)` group (admin-gated by its layout)

- **`apps/web/app/(dashboard)/reports/page.tsx`** — Today overview. `PageHeader title="Reports"`
  + `DataTable`: **Team** (link) · **Standup** · **Date** · **Status** (`StatusPill`) ·
  **Reported** (`reported/total`) · **View →** (`/reports/[teamId]`). Empty state when there are
  no standups. Fills the existing dead `Reports → /reports` nav item.
- **`apps/web/app/(dashboard)/reports/[teamId]/page.tsx`** — per-team detail + history. Reads
  `searchParams.date` (default latest). Shows the run's date + status, a **history selector**
  rendered as server-side **links** to `?date=YYYY-MM-DD` (a compact row of recent run dates from
  `listTeamRunDates`, the active one highlighted — no client JS), and a member `DataTable`:
  **Member** · **Status** (`StatusPill`) · **Answers** (inline Q&A via a small `ReportAnswers`
  component). "No run on this date" / "No standup configured" empty states.
  Back-link to the team page; the team page (`teams/[id]`) gets a "View reports →" link.

### 3. Components

- Reuse `PageHeader`, `DataTable`/`Th`/`Td`, `StatusPill`, `buttonVariants`.
- New `apps/web/components/reports/report-answers.tsx` — renders `{ question, answer }[]` as a
  compact definition list (question in medium weight, answer below), matching the app's styling.
- **Status → pill tone:** `completed` → `success` "Reported"; `in_progress` → `neutral` "Pending";
  `timed_out` → `danger` "Timed out"; `absent` → `neutral` "—"; run `running` → `warning`,
  `completed` → `success`.

## Data flow

```
/reports          → getTodayOverview()        → table of teams (today's participation)
/reports/[teamId] → listTeamRunDates(teamId)   → date selector
                  → getRunDetail(teamId, date) → member rows + interpolated answers
```

## Error / empty states

- No teams / no active standups → "No standups configured yet" with a link to Teams.
- Team has a standup but no run for the chosen date (e.g. not an active weekday) → "No standup ran
  on {date}."
- `getRunDetail` for an unknown team → Next `notFound()` (matches `teams/[id]`).

## Testing

- **Integration (real PG), `apps/web/lib/reports.test.ts`** — mirrors `teams.test.ts`/
  `standups.test.ts`. Seed a team + standup + run + reports in mixed states (completed with
  answers incl. a `{last_report_date}` token + a prior report, in_progress, timed_out, an absent
  member) and assert: `getTodayOverview` participation counts + today filter; `getRunDetail` rows,
  statuses, and **interpolated** answers (no raw token); `listTeamRunDates` ordering/limit.
- Pages are thin Server Components over the tested lib (the repo tests data-access + smokes, not
  component renders) — no page render tests.

## Definition of done

1. `lib/reports.test.ts` green in CI; full suite green.
2. Live check: `/reports` shows today's participation across teams; `/reports/[teamId]` shows a
   run's answers with the interpolated date and lets you browse a past date.
3. README feature checklist: tick a "Reports dashboard (today + history)" item; note it's
   admin-only (existing auth).
4. ContextDB updated: a short note in the architecture docs (or a new `reports.md`) + the build
   log; mark Phase 2 sub-project A done.

## Files (anticipated)

```
apps/web/lib/reports.ts (+ test)                       # getTodayOverview / getRunDetail / listTeamRunDates
apps/web/app/(dashboard)/reports/page.tsx              # today overview
apps/web/app/(dashboard)/reports/[teamId]/page.tsx     # per-team detail + history
apps/web/components/reports/report-answers.tsx         # inline Q&A renderer
apps/web/app/(dashboard)/teams/[id]/page.tsx           # add "View reports →" link
README.md · ContextDB/* · build log                     # DoD
```

## Notes / reuse

- `lastReportDateBefore` (`@poddaily/db`) and `interpolateLastReportDate` (`@poddaily/shared`)
  already exist (shipped with the broadcast fix) — the dashboard reuses them for answer rendering.
- No new schema, no REST API, no new env. Purely additive in `apps/web`.
