# 2026-06-27 — Phase 2-D RBAC live smoke

Walked the Phase 2-D RBAC live-smoke runbook against the deployed Dokploy instance (Supabase
cloud Postgres) — the last open Definition-of-Done item for the role-tiers work. Spec:
[phase-2-d-rbac-spec.md](../01_specs/phase-2-d-rbac-spec.md).

## Result — working

- First-login **bootstrap** promotes the logging-in user to `admin` (zero admins → admin); the
  **People** page renders and role assignment works. Fresh-per-request role reads confirmed: a
  role change is reflected on the next page load, no re-login.
- The automated `smoke:rbac` (viewer/manager/admin matrix) and full `pnpm test` (40 files / 165
  tests) were already green before the walk.

## Snag hit during the walk (and the lesson)

On first attempt the admin user saw **no People link** and got `ForbiddenError` at `/people`,
despite being "logged in." Root cause: a **stale JWT session from before the RBAC deploy**. The
new `session` callback runs on every request (it reshapes the existing token, so `session.user.id`
populated and the user looked logged in), but the `signIn`/provisioning callback only runs at
authentication time — so no `app_users` row was ever created and the user defaulted to `viewer`.
Tell-tale: `select * from app_users` was **empty** while the dashboard still rendered.

**Fix:** full sign-out + sign-in. The re-login ran provisioning, `app_users` was empty → zero
admins → bootstrap promoted the user to `admin`. This is now captured as a deploy gotcha in
[deployment-dokploy.md](../02_architecture/deployment-dokploy.md#production-gotchas-learned-walking-the-step-5b-live-deploy).

## Shipped alongside

- **Sidebar sign-out button** — the dashboard had no logout control (`signOut` was exported but
  never wired to UI), which is what made the stale-session state feel like a dead end. Added a
  `signOut` server action wired into the sidebar footer. Merged to `main` (`3a5cb9d`).

## Deferred (by decision)

- `SUPERADMIN_SLACK_IDS` env escape hatch for bootstrap recovery — not needed yet (single
  operator). Revisit if multiple admins or a locked-out install becomes a real risk.

Phase 2-D RBAC is now **fully done** per the Definition of Done (automated smoke green, live smoke
walked, README + ContextDB updated).
