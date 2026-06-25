# Admin Controls — Pause/Resume + Connected Badge (Phase 2-C)

- **Date:** 2026-06-24
- **Status:** Accepted (brainstorming)
- **Phase:** 2 — sub-project C (admin UX)
- **Motivation:** Admins have no way to (1) temporarily stop a standup without deleting it, or
  (2) see which members have connected their reporter user-OAuth token (and so post as
  themselves vs. degrade to the bot fallback).

## Summary

Two small, independent admin-UI features, both following the existing Server-Component +
server-action + `revalidatePath` pattern. **No worker changes, no Slack config, no new smoke.**

- **A — Pause/Resume a standup** by reusing `standups.is_active` (no schema change). A status pill
  + Pause/Resume button on the standup config page.
- **B — "Slack connected" badge** per member in the team-detail member table, from a batch
  token-existence query.

## Scope

**In scope:**
- Pause/resume toggle on the standup config page (`/teams/[id]/standup`), reusing `is_active`.
- Per-member connected/not-connected pill in `MemberTable` on the team detail page.

**Out of scope (YAGNI / later):**
- An audit trail of who paused/resumed and when (no `paused_at`/`paused_by` columns).
- Cancelling an in-flight run when pausing (pause is **future-only** by construction).
- The connected indicator on the reports dashboard cards (team-admin surface only for now).
- Pause/resume at the team level or bulk actions (per-standup only; Phase 1 is one standup/team).

## Part A — Pause / Resume a standup

### State & semantics
- Reuse `standups.is_active`: **Active** = `true`, **Paused** = `false`. A newly-created standup
  stays active by default (current behavior). **No schema change.**
- **Future-only:** pausing stops the *next* scheduled run onward; any run already open for today
  and its in-progress reports continue untouched. This falls out of the existing design — nothing
  tears down in-flight state.

### Why it takes effect without a worker restart
- `openRun` already returns early when `!standup.isActive` (`apps/worker/src/openRun.ts`), so a
  paused standup's `open-run` tick is a no-op at execution time — pausing is effective at the very
  next tick.
- `reconcileSchedules` selects `is_active = true` standups and removes repeatable jobs for the
  rest, but it runs **only at worker boot** (and via the reconcile CLI). So a paused standup's
  repeatable `open-run` job lingers and keeps firing until the next reconcile removes it — each
  such tick harmlessly no-ops via the `openRun` guard. This eventual-cleanup behavior is expected
  and documented; correctness does not depend on prompt reconciliation.
- `retrigger` also guards on `standup.isActive`, so a paused standup cannot be re-triggered by a
  member DM keyword either — consistent.

### Data access
- New `setStandupActive(teamId: string, active: boolean): Promise<void>` in
  `apps/web/lib/standups.ts` — updates `standups.is_active` for the team's standup.

### UI
- On the standup config page (`/teams/[id]/standup`): a status pill (**Active** success tone /
  **Paused** muted tone) and a Pause/Resume `<form>` button wired to a server action that calls
  `setStandupActive(id, next)` then `revalidatePath(\`/teams/${id}/standup\`)`.
- Shown only when a standup is configured (`getStandup(id)` returns a row). If none exists yet,
  no control is rendered (nothing to pause).
- The button label and target state derive from the current value: Active → "Pause", Paused →
  "Resume".

## Part B — "Slack connected" badge

### Data access
- New `listConnectedUserIds(db, slackUserIds: string[]): Promise<string[]>` in
  `packages/db/src/tokens.ts` (exported from the db package index) — the batch sibling of
  `hasUserToken`: a single `select slack_user_id from slack_user_tokens where slack_user_id in
  (...)`, existence only, **no decryption**. Returns `[]` for an empty input (no query).

### Wiring
- The team detail page (`apps/web/app/(dashboard)/teams/[id]/page.tsx`) already calls
  `listMembers(id)`. It then calls `listConnectedUserIds(db, members.map(m => m.slackUserId))`,
  and passes the result as a new `connectedUserIds: string[]` prop to `MemberTable`.
- `listMembers`' return type stays unchanged (raw `TeamMember[]`) — token existence is composed in
  the page, not joined into the membership query. (Alternative: a left-join inside `listMembers`
  returning a `connected` flag per row — rejected; it would muddy that function's single
  responsibility for one badge.)

### UI
- `MemberTable` (`apps/web/components/teams/member-table.tsx`) gains a `connectedUserIds: string[]`
  prop (build a `Set` once) and one new column rendering a pill: **Connected** (success tone) when
  the member's `slackUserId` is in the set, **Not connected** (muted/neutral tone) otherwise.
- Reuse the existing `StatusPill` component used elsewhere in the app for tone consistency.

## Error handling
- `setStandupActive` on a team with no standup: a no-op update (0 rows) — but the UI never offers
  the control in that case, so it won't be reached in practice.
- `listConnectedUserIds([])` short-circuits to `[]` (drizzle `inArray` with an empty list is
  avoided). The page handles a team with zero members (the table already renders an empty state).
- Both features are read/membership-scoped and admin-only (the dashboard is already behind admin
  auth); no new authz surface.

## Testing
- `apps/web/lib/standups.test.ts`: `setStandupActive` flips `is_active` true→false and false→true
  for a seeded standup; reading back confirms the value.
- `packages/db/src/tokens.test.ts` (extend): `listConnectedUserIds` returns only the connected ids
  from a mixed input (some with a saved token, some without), and `[]` for an empty input.
- The "paused standup does not open a run" behavior is already covered by the existing `openRun`
  tests' `!isActive` guard — noted, not duplicated.
- No new smoke suite: this is admin UI + two data-access helpers.

## Definition of done
1. New unit tests green in CI; full `pnpm test` green.
2. README: a short "Admin controls" note (pause/resume a standup; connected badge meaning) in the
   web/admin section. ContextDB: a build log; note the eventual-reconcile cleanup behavior.
3. No schema change, no Slack config change, no worker change.
4. (No live-workspace smoke needed; optional manual check: pause a standup in the UI, confirm the
   pill flips and the next scheduled run doesn't fire.)

## Files (anticipated)
```
packages/db/src/tokens.ts (+ index re-export) (+ tokens.test.ts)   # listConnectedUserIds
apps/web/lib/standups.ts (+ standups.test.ts)                       # setStandupActive
apps/web/app/(dashboard)/teams/[id]/standup/page.tsx               # pause/resume control + action
apps/web/app/(dashboard)/teams/[id]/page.tsx                       # compute connectedUserIds, pass prop
apps/web/components/teams/member-table.tsx                         # connected pill column
README.md · ContextDB/08_logs/2026-06-24-admin-controls.md         # DoD
```
