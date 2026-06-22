# Phase 2 Backlog

Captured items for Phase 2 (Phase 1 Core is feature-complete as of 2026-06-21). Each gets
its own spec → plan → implementation cycle when picked up.

## From live-runbook feedback (2026-06-21)

- **"Slack connected" badge in the web app.** Surface, per team member in the admin UI,
  whether that member has connected their reporter user-OAuth (post-as-user) token. Source of
  truth: `slack_user_tokens` (existence check, like `hasUserToken`). Helps admins see who will
  post as themselves vs. degrade to the bot fallback.

- **(Candidate, may land as Phase 1 polish instead)** Connect-success **Slack DM confirmation.**
  Today the OAuth callback shows a web "Connected ✅" page; an in-Slack DM ("✅ You're connected —
  your standups will now post as you") closes the loop where the user actually is. Small change
  to the web callback (post one DM via the bot after storing the token).

## Deferred from the PRD / Phase 1 spec

- **Reports timeline + dashboard UI** (admin views of past standups/runs).
- **`/reports`, `/reports/today` API** (and `/api/teams/:id/standup/toggle`) — deferred in the
  Phase 1 API surface.
- **Reminders** — the `standup_reminders` table exists but is unused; nudge members who haven't
  responded before the 4h timeout. (`/reminders` API also deferred.)
- **RBAC tiers** (PRD Q3) — Phase 1 default is "anyone who completes admin Slack OAuth is an
  admin"; role tiers (EM/director) deferred.
- **Prior-tool data migration** (PRD Q5) and **compliance/retention on stored answers**
  (PRD Q6) — confirm before storing security-team standup data.
