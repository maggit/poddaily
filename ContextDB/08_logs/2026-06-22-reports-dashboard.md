# 2026-06-22 — Reports Dashboard (Phase 2, sub-project A)

Executed the Reports Dashboard plan on branch `feat/reports-dashboard`. The admin web app now
has a read-only reports view: `/reports` shows today's run across all teams (participation +
status), and `/reports/[teamId]` is a feed of per-person check-in cards (Slack avatar + name +
status + the member's Q&A answers) with a date selector to browse history. This is the **first
Phase 2 sub-project (A)** — Phase 1 Core shipped feature-complete on 2026-06-21.

Plan: [docs/superpowers/plans/2026-06-22-reports-dashboard.md](../../docs/superpowers/plans/2026-06-22-reports-dashboard.md).
Spec: [docs/superpowers/specs/2026-06-22-reports-dashboard-design.md](../../docs/superpowers/specs/2026-06-22-reports-dashboard-design.md).

## What shipped

- **slack-stub — `users.info` fake.** Returns `ok: true` with a `profile.image_*`, `tz`, and
  `real_name` so the avatar path is exercisable offline.
- **`slack-client.getUserProfile` (wraps `users.info`).** New `SlackClient` method returning
  `{ image, tz, realName }`; prefers `image_512`, falls back to `image_192`, else `null`. The
  in-test `SlackClient` fakes were updated to include it. Needs the bot **`users:read`** scope.
- **Avatar persistence + fetch-on-member-add + backfill.** `apps/web/lib/teams.ts` gained
  `setMemberAvatar(memberId, url)` and `listMembersMissingAvatar()` (members with a null
  `team_members.slack_avatar_url`). The team page's `addMemberAction` now best-effort fetches
  the new member's avatar via `getUserProfile` and persists it — a Slack failure is logged and
  swallowed, never blocking the add. A one-off backfill script
  (`apps/web/scripts/backfill-avatars.ts`, exposed as `pnpm --filter @poddaily/web
  backfill:avatars`) walks the missing-avatar members and fills them in. `tsx` was added to
  `apps/web` to run it.
- **`apps/web/lib/reports.ts` — Server-Component data-access.** `getTodayOverview()` (one row
  per active standup: today's run by `scheduled_date = current_date` + `reported/total`),
  `getRunDetail(teamId, date?)` (a card per `can_report` member — `completed` / `in_progress` /
  `timed_out` / `absent` — with answers; `null` for an unknown team), and `listTeamRunDates()`
  (recent runs newest-first with counts, for the history selector). Completed answers render the
  interpolated `{last_report_date}` via the shared `lastReportDateBefore` +
  `interpolateLastReportDate`, matching the DM and channel broadcast.
- **UI components.** `components/ui/avatar.tsx` (img-or-initials, initials fallback when the
  avatar is missing) and `components/reports/report-card.tsx` (per-member check-in card:
  avatar + name + status pill + Q&A list).
- **Pages.** `/reports` (today overview, `DataTable` of teams linking through) and
  `/reports/[teamId]` (the card feed + history date pills; `notFound()` on an unknown team).
  A "View reports →" link was added to the team page.

## Verification

- `pnpm test` (Postgres + Redis up): **31 files / 127 tests passing** (unit + integration,
  including the Redis-backed smoke suites that run as part of the default `vitest` run, plus the
  new slack-stub `users.info`, slack-client `getUserProfile`, `teams` avatar, and `reports`
  data-access tests).

```
 Test Files  31 passed (31)
      Tests  127 passed (127)
```

- `pnpm --filter @poddaily/web exec tsc --noEmit` — clean.
- `pnpm --filter @poddaily/web build` — compiles, including the two new routes
  `/reports` and `/reports/[teamId]`.

## Notable decisions

- **Card-feed UI inspired by a reference.** Took the per-person check-in card layout from a UI
  reference; deliberately did **not** build its integration rows, reactions, comments, or AI
  highlights (out of scope — see below).
- **Server-Component data-access, no REST.** Reports read straight from `@poddaily/db` in
  Server Components (`lib/reports.ts`); no `/reports` HTTP API was added (the deferred Phase 1
  `/reports` API stays deferred).
- **today = `current_date`, with a date label.** The overview joins today's run on
  `scheduled_date = current_date` and shows the run's `scheduledDate`; the detail page defaults
  to the latest run and lets you pick a past date.
- **Render-time `{last_report_date}` interpolation reusing the shared helper.** Answers are
  interpolated at render with the same `lastReportDateBefore` + `interpolateLastReportDate`
  used by the DM and the broadcast, so all three surfaces read identically.
- **Real Slack avatars (`users:read`) with an initials fallback.** Avatars come from
  `users.info`, stored in the existing `team_members.slack_avatar_url` (no new schema);
  members without an avatar render initials.
- **`isNull` re-exported from `@poddaily/db`.** Used `@poddaily/db`'s re-export of `isNull`
  (alongside `eq`, `and`, etc.) rather than importing from `drizzle-orm` directly, to avoid the
  dual-package drizzle hazard.
- **`tsx` added to `apps/web`** so the backfill script runs the same way the worker/api scripts do.

## Definition of done — honest status

- Automated `pnpm test` (unit + integration, incl. the new slack-stub, slack-client, teams,
  and reports tests + existing suites) green — ✓.
- Web `tsc --noEmit` clean and `pnpm --filter @poddaily/web build` compiles the two new routes — ✓.
- Root `README.md` + `ContextDB/00_index/getting-started.md` updated (feature checklist + an
  admin-only Reports dashboard section, the `users:read` scope, and the
  `backfill:avatars` step), and this log added — ✓.
- **Live walk against a real Slack dev workspace — NOT yet done.** Pending human/operator steps:
  - view a real run in `/reports` → a team feed and confirm avatars render + answers show the
    interpolated `{last_report_date}` + the history selector works;
  - run `pnpm --filter @poddaily/web backfill:avatars` once against the real workspace;
  - confirm the bot has the **`users:read`** scope.

So the Reports dashboard is **CI-green and documented, but NOT yet live-verified end-to-end**.

## Phase 2

Sub-project **A (reports dashboard) is done** (pending the live walk). Remaining sub-projects —
**B reminders**, **C admin controls** (incl. the "Slack connected" badge and pause/resume),
**D RBAC** — are tracked in [phase-2-backlog.md](../todos/phase-2-backlog.md).
