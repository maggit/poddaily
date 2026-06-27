# Phase 2 Backlog

Phase 1 Core was feature-complete 2026-06-21. Phase 2 (Admin UX) is **complete** — all four
sub-projects (A–D) shipped. Each item had its own spec → plan → implementation cycle.

## ✅ Shipped (Phase 2 + extras)

Phase 2 sub-projects:
- **A — Reports dashboard** (today + history, per-person check-in feed with Slack avatars,
  admin-only). Build log: `08_logs/2026-06-22-reports-dashboard.md`.
- **B — Reminders** (recurring DM nudges to unfinished members, per-standup interval, default
  60 min, 0 = off). Build log: `08_logs/2026-06-24-reminders.md`.
- **C — Admin controls:**
  - Pause/resume a standup (reuses `is_active`, future-only) — config page.
  - **"Slack connected" badge** per member in the team table (existence check on
    `slack_user_tokens`). Build log: `08_logs/2026-06-23-admin-controls.md` (note: dated file is
    the C build log).

Extras shipped alongside (not in the original A–D plan):
- **Connect-success Slack DM** — the OAuth callback now DMs "✅ You're connected" (was a candidate
  here; shipped as Phase 1 polish).
- **Re-trigger a missed/timed-out standup** via a DM keyword (`redo` / `restart` / `start` /
  `standup`), incl. whole-team recovery when it has to open the run. Build log:
  `08_logs/2026-06-23-standup-retrigger.md`.
- **Late-join delivery** — adding a member (or granting Report) mid-day delivers today's standup
  if the run is open. Build log: `08_logs/2026-06-24-late-join.md`.
- **Inactivity-based timeout (bug fix)** — the per-report timeout now resets on each reply (was a
  fixed deadline from send time that cut members off mid-conversation). Build log:
  `08_logs/2026-06-26-inactivity-timeout.md`.
- **Build verification hardening** — `pnpm test` now runs web ESLint + `tsc` before vitest, so a
  lint/type error in `apps/web` can't pass local checks and break the Docker build.
- **D — RBAC tiers** (PRD Q3) — three DB-backed role tiers (viewer / manager / admin) gating
  who can edit teams and standups; first-login bootstrap (zero-admins → admin); auto-provision
  new logins as viewer; per-team manager ownership via `team_managers` join table; People page
  for role assignment; last-admin safeguard.
  Spec: [../01_specs/phase-2-d-rbac-spec.md](../01_specs/phase-2-d-rbac-spec.md) ·
  Plan: [../../docs/superpowers/plans/2026-06-26-phase-2-d-rbac.md](../../docs/superpowers/plans/2026-06-26-phase-2-d-rbac.md)

## ⬜ Remaining

_(Phase 2 is complete — all A–D items shipped.)_

## Deferred from the PRD / Phase 1 spec (decide before building)

- **REST `/reports`, `/reports/today` API** — largely moot: the dashboard is Server-Component
  data-access, no REST needed. **`/api/teams/:id/standup/toggle`** is covered in practice by the
  pause/resume server action.
- **`/reminders` API** — reminders shipped as an automatic worker flow (B); a REST surface is
  unneeded unless an external integration wants it.
- **Prior-tool data migration** (PRD Q5) — only if importing history from a previous standup tool.
- **Compliance / retention on stored answers** (PRD Q6) — confirm a retention policy before
  storing sensitive (e.g. security-team) standup data long-term.

## Beyond Phase 2

- **Phase 3 — launch polish:** deploy is live on Dokploy; remaining is env/docs hardening + a real
  pilot.
- **Phase 4 — P1 features:** `/standup` slash command, analytics/participation stats, Databricks
  export webhook, streaks.
