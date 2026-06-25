# 2026-06-24 — Admin controls (pause/resume + connected badge)

Phase 2 sub-project C (admin UX). Two small, independent admin-UI features on the existing
Server-Component + server-action + `revalidatePath` pattern. Spec:
[2026-06-24-admin-controls-design.md](../../docs/superpowers/specs/2026-06-24-admin-controls-design.md).
Plan: [2026-06-24-admin-controls.md](../../docs/superpowers/plans/2026-06-24-admin-controls.md).

## What shipped

- **Part A — Pause / resume a standup.** Reuses `standups.is_active` (no schema change). New
  `setStandupActive(teamId, active)` in `apps/web/lib/standups.ts`; a status pill (**Active** /
  **Paused**) + Pause/Resume button on the standup config page (`/teams/[id]/standup`), shown only
  when a standup is configured. **Future-only:** an in-flight run for today finishes; only future
  scheduled runs stop.
- **Part B — "Slack connected" badge.** New `listConnectedUserIds(db, slackUserIds)` in
  `packages/db/src/tokens.ts` (batch existence, no decryption — the list-sibling of
  `hasUserToken`). The team detail page composes it from the member list and passes
  `connectedUserIds` to `MemberTable`, which renders a **Connected** / **Not connected** pill per
  member. `listMembers` stays membership-only (token existence joined in the page, not the query).

## Verification

- `pnpm test` — **139 passed / 139** (33 files), 0 failures.
- New unit tests: `listConnectedUserIds` (only connected ids; `[]` for empty input) in
  `packages/db/src/tokens.test.ts`; `setStandupActive` (pause then resume flips `is_active`) in
  `apps/web/lib/standups.test.ts`. The UI tasks (config-page control, member-table column) are
  thin compositions verified by `tsc --noEmit`.
- No new smoke suite (admin UI + two data-access helpers).

## Notable decisions

- **Reuse `is_active`** rather than a new `paused_at` column — no schema change, and there's no
  separate archive concept; pause = `is_active false`.
- **Effective without a worker restart.** `openRun` already returns early on `!standup.isActive`,
  so pausing is effective at the next scheduled tick. `reconcileSchedules` removes the now-inactive
  repeatable job only at the next worker boot/reconcile — until then the orphaned tick harmlessly
  no-ops via the `openRun` guard. Correctness doesn't depend on prompt reconciliation.
- **Future-only pause** — no teardown of in-flight runs/reports (simplest, least surprising).
- **Badge composed in the page** — keeps `listMembers` focused on membership; the connected set is
  a separate batch query.
- **No new authz** — the dashboard is already admin-gated.

## Definition of done

1. New unit tests + full `pnpm test` green ✅ (139/139).
2. README "Admin controls" note added ✅; this build log ✅ (documents the eventual-reconcile
   cleanup behavior).
3. No schema change, no Slack config change, no worker change ✅.
4. Live check optional: pause a standup in the UI, confirm the pill flips and the next scheduled
   run doesn't fire — **pending** (not gating).

## Backlog after this

Phase 2 remaining: **B — reminders** (the `standup_reminders` table is still unused), **D — RBAC
tiers**. See [phase-2-backlog.md](../todos/phase-2-backlog.md).
