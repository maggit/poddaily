# Reports Dashboard Design (Phase 2, sub-project A)

- **Date:** 2026-06-22
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — first sub-project (the deferred P0 "today's dashboard")
- **Predecessor:** Phase 1 Core (feature-complete)
- **UI inspiration:** a check-ins feed (per-person cards: avatar + name + grouped answers), dark theme.

## Summary

Phase 1 built the bot pipeline (running standups); there's still no way to **view** standups in
the admin app. This adds the **Reports Dashboard**: a global "today across all teams" overview
plus a per-team **feed of per-person check-in cards** (Slack avatar + name + status + the
member's Q&A answers) with history browsing. Read-only, Server-Component data-access. It also
adds **Slack avatar enrichment** (fetch member profile photos via `users.info`) so the cards show
real Slack pictures.

## Scope

**In scope (v1):**
- **Today overview** (`/reports`): every active standup's run for today — participation
  (reported / total), run status, link to detail.
- **Per-team detail + history** (`/reports/[teamId]`): a **feed of check-in cards** (one per
  `can_report` member) for the selected run — avatar + name + status + inline Q&A answers;
  non-reporters shown as muted "yet to report / timed out" cards. A date selector browses the
  team's past runs.
- **Slack avatar enrichment**: `slack-client.getUserProfile` (wraps `users.info`); populate
  `team_members.slack_avatar_url` when a member is added + a backfill for existing members.
- Server-Component data-access in `apps/web/lib/reports.ts` (no REST layer).

**Explicitly NOT in scope** (inspiration has them; poddaily doesn't, and they'd balloon scope):
third-party integration rows (Notion/Trello/GitHub/Linear), reactions, comments / view counts, AI
"highlights." We take the *layout & feel*, not those features.

**Deferred / later (P1):** live/real-time updates (server render + Next revalidation is fine);
CSV/export; charts/analytics; editing from the dashboard; reminders (sub-project B); RBAC gating
beyond the existing admin-only `(dashboard)` layout.

## Decisions locked

1. **Today + history**, **global overview + per-team detail (card feed)**, **Server-Component
   data-access** (the brainstorm forks).
2. **"Today" = `scheduled_date = current_date`**, and every view **shows the run's date label** so
   near-midnight timezone edges are unambiguous (no per-standup-tz "today" logic in v1).
3. **Answers interpolated at render** — `{last_report_date}` in a stored `questionText` is replaced
   via `interpolateLastReportDate` using `lastReportDateBefore(db, slackUserId, report.createdAt)`
   (the shared helper already shipped), so the dashboard shows the same date as the DM + channel.
4. **Real Slack avatars** — fetched via `users.info` (needs the bot's `users:read` scope, already
   planned). Rendered with an **initials fallback** when still missing.
5. **Read-only** dashboard. The only writes are the avatar enrichment (member-add + backfill).

## Architecture & components

### 1. Slack avatar enrichment

- **`packages/slack-client`** — add `getUserProfile(slackUserId)` wrapping `users.info`:
  returns `{ image: string | null; tz: string | null; realName: string | null }` (from
  `user.profile.image_192` / `user.tz` / `user.real_name`). Needs `users:read`. Reads
  `SLACK_BOT_TOKEN` + `SLACK_API_BASE_URL` like the rest of the client.
- **Member add** (`apps/web` `teams/[id]` server action): after `addMember`, best-effort
  `getUserProfile(slackUserId)` → `setMemberAvatar(memberId, image)`. A Slack failure must not
  block adding the member (avatar stays null → initials fallback). `addMember`/a new
  `setMemberAvatar` in `apps/web/lib/teams.ts`.
- **Backfill** — `apps/web/lib/teams.ts` `backfillAvatars()` (loops `team_members` with null
  `slack_avatar_url`, fetches + sets), exposed as a one-off `pnpm` script under `apps/web` (run
  once against the live DB). Best-effort per member.
- **Stub** — `tools/slack-stub` fakes `users.info` returning a `profile.image_192` so the
  enrichment is testable offline.

### 2. Data-access — `apps/web/lib/reports.ts` (Server Components, over the web `db` singleton)

```ts
export interface OverviewRow {
  teamId: string; teamName: string; slackChannelName: string; standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null; // null = no run today
  reported: number; total: number;
}
/** One row per active standup: today's run (scheduled_date = current_date) + participation. */
export async function getTodayOverview(): Promise<OverviewRow[]>;

export interface ReportCard {
  slackUserId: string; displayName: string; avatarUrl: string | null;
  status: "completed" | "in_progress" | "timed_out" | "absent";
  answers: { question: string; answer: string }[]; // interpolated; empty unless completed
  reportedAt: Date | null;
}
export interface RunDetail {
  team: { id: string; name: string; slackChannelName: string };
  standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  cards: ReportCard[]; reported: number; total: number;
}
/** A team's run for `date` (default = latest), with each member's status + interpolated answers. */
export async function getRunDetail(teamId: string, date?: string): Promise<RunDetail>;

export interface RunDate { date: string; status: string; reported: number; total: number; }
export async function listTeamRunDates(teamId: string, limit?: number): Promise<RunDate[]>;
```

- `total`/`reported` derive from `standup_reports` for the run (consistent with the broadcast
  counter). `cards`: left-join `can_report` members to the run's reports; no row → `"absent"`.
  Answers interpolated via `lastReportDateBefore` + `interpolateLastReportDate` per card. Read-only.

### 3. Pages — App Router, under `(dashboard)` (admin-gated by its layout)

- **`/reports`** (`reports/page.tsx`) — Today overview. `PageHeader title="Reports"` + a
  `DataTable`: **Team** (link) · **Standup** · **Date** · **Status** (`StatusPill`) · **Reported**
  (`reported/total`) · **View →**. Empty state when no standups. Fills the dead `Reports` nav item.
- **`/reports/[teamId]?date=`** (`reports/[teamId]/page.tsx`) — **card feed**. Reads
  `searchParams.date` (default latest). Shows the run's date + status, a **history selector**
  rendered as server-side **links** to `?date=YYYY-MM-DD` (recent runs from `listTeamRunDates`,
  active one highlighted — no client JS), then the feed: a `ReportCard` component per member.
  Empty states: "No standup ran on {date}" / "No standup configured."

### 4. Components

- Reuse `PageHeader`, `DataTable`/`Th`/`Td`, `StatusPill`, `buttonVariants`.
- **`apps/web/components/reports/report-card.tsx`** — one member's check-in card (inspired by the
  reference): avatar (Slack `avatarUrl`, else an initials circle) + display name + a `StatusPill`,
  then the Q&A rendered as labeled question / answer blocks. A muted variant for `in_progress`
  ("yet to report") / `timed_out` ("didn't finish") / `absent`.
- **`apps/web/components/ui/avatar.tsx`** — small avatar: renders `<img>` for a URL, else an
  initials circle from the display name. Reusable (member table could adopt it later).
- **Status → pill tone:** `completed` → `success` "Reported"; `in_progress` → `neutral` "Pending";
  `timed_out` → `danger` "Timed out"; `absent` → `neutral` "—"; run `running` → `warning`,
  `completed` → `success`.

## Data flow

```
/reports          → getTodayOverview()        → team table (today's participation)
/reports/[teamId] → listTeamRunDates(teamId)   → history date links
                  → getRunDetail(teamId, date) → ReportCard feed (avatar + status + interpolated answers)
member add        → addMember → getUserProfile(users.info) → setMemberAvatar (best-effort)
```

## Error / empty states

- No teams / no active standups → "No standups configured yet" + link to Teams.
- Standup but no run for the chosen date (e.g. not an active weekday) → "No standup ran on {date}."
- Unknown team in `getRunDetail` → Next `notFound()` (matches `teams/[id]`).
- Avatar/profile fetch failure → swallowed; member added without avatar (initials fallback).

## Testing

- **`packages/slack-client`** — `getUserProfile` against the stub's faked `users.info` (asserts it
  returns the image/tz/realName).
- **`tools/slack-stub`** — `users.info` fake + a test.
- **`apps/web/lib/reports.test.ts`** (real PG, mirrors `teams.test.ts`/`standups.test.ts`) — seed a
  team + standup + run + reports in mixed states (completed-with-answers incl. a `{last_report_date}`
  token + a prior report, in_progress, timed_out, an absent member) and assert: `getTodayOverview`
  counts + today filter; `getRunDetail` cards/statuses/avatarUrl and **interpolated** answers (no
  raw token); `listTeamRunDates` ordering/limit.
- **`apps/web/lib/teams.test.ts`** — `setMemberAvatar` persists; `addMember` still works without an
  avatar.
- Pages + presentational components are thin over the tested lib — no page-render tests (matches
  the repo's data-access-first test style).

## Definition of done

1. `lib/reports.test.ts`, slack-client, and stub tests green in CI; full suite green.
2. Live check: `/reports` shows today's participation; `/reports/[teamId]` shows the card feed with
   real Slack avatars + interpolated answers and lets you browse a past date; new members get an
   avatar; the backfill populates existing members.
3. Operational: confirm the Slack app has the **`users:read`** scope; the **web service has
   `SLACK_BOT_TOKEN`** (already set for the connect DM); run the avatar backfill once.
4. README feature checklist: tick "Reports dashboard (today + history, per-person check-in feed)";
   note admin-only + the `users:read` scope. ContextDB note + build log; mark Phase 2 sub-project A
   done.

## Files (anticipated)

```
packages/slack-client/src/index.ts (+ test)            # getUserProfile (users.info)
tools/slack-stub/src/server.ts (+ test)                # fake users.info
apps/web/lib/teams.ts (+ test)                          # setMemberAvatar, backfillAvatars
apps/web/scripts/backfill-avatars.ts                    # one-off backfill runner
apps/web/lib/reports.ts (+ test)                        # getTodayOverview / getRunDetail / listTeamRunDates
apps/web/app/(dashboard)/reports/page.tsx              # today overview
apps/web/app/(dashboard)/reports/[teamId]/page.tsx     # per-team card feed + history
apps/web/components/reports/report-card.tsx            # per-member check-in card
apps/web/components/ui/avatar.tsx                       # avatar w/ initials fallback
apps/web/app/(dashboard)/teams/[id]/page.tsx           # add "View reports →" link + fetch avatar on add
README.md · ContextDB/* · build log                     # DoD
```

## Notes / reuse

- `lastReportDateBefore` (`@poddaily/db`) and `interpolateLastReportDate` (`@poddaily/shared`)
  already exist — reused for answer rendering.
- No new schema (`slack_avatar_url` already exists, just unpopulated). No REST API. No new env
  (`SLACK_BOT_TOKEN` on web already set). Needs the `users:read` Slack scope.
