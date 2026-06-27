# Phase 2-D — RBAC Tiers — Design Spec

> Validated design for role-based access control. Derived from the
> [Phase 2 backlog](../todos/phase-2-backlog.md) (item D), [PRD Q3](poddaily-prd.md), and
> the brainstorming session on 2026-06-26. Resolves the deferred RBAC question from
> [Phase 1](phase-1-core-spec.md#L186).

## 1. Problem

Today, anyone who completes admin Slack OAuth is a full admin: the `authorized` callback in
[`auth.config.ts`](../../apps/web/auth.config.ts) admits any authenticated Slack user, and no
server action checks anything beyond session existence. This spec adds three role tiers gating
who can edit teams and standups.

## 2. Scope

**In scope:**
- Three global role tiers: **viewer**, **manager**, **admin**.
- DB-backed roles with first-login bootstrap and auto-provisioning of new users as viewers.
- Per-team manager ownership (many-to-many) scoping which teams a manager can edit.
- Authorization guards on every dashboard mutation (server actions) and on admin-only pages.
- Admin "People" page to assign global roles; per-team "Managers" assignment UI.
- UI gating (hide/disable edit controls for users who can't edit).

**Out of scope:**
- Changing the reporter-facing `team_members` permissions (`canView`/`canReport`/`canEdit`) —
  those govern standup participation, not dashboard administration, and are unchanged.
- SSO / non-Slack identity, audit logging of role changes, per-resource ACLs finer than
  team-level. (Deferrable; not needed for a small internal tool.)

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Tier model | Three tiers: **viewer** (read-only) / **manager** (edit owned teams) / **admin** (everything) |
| Role storage | DB table (`app_users`) as source of truth, editable in the admin UI |
| Bootstrap | **First login while zero admins exist → admin**; otherwise new users → viewer |
| Unknown users | **Auto-provision as viewer** on first login (read-only access to all teams/reports) |
| Manager scope | **`team_managers` join table** — many managers per team, many teams per manager |
| Role evaluation | Read **fresh from DB per request** (not baked into the JWT) so changes take effect immediately |
| Manager assignment | Two-step: admin promotes a user to `manager` on the People page, then assigns them to specific teams |

## 4. Permission matrix

| Action | Viewer | Manager | Admin |
|---|:---:|:---:|:---:|
| View dashboard / reports | ✅ | ✅ | ✅ |
| Create team | ❌ | ❌ | ✅ |
| Edit team / add-remove members / set member perms | ❌ | owned teams | ✅ |
| Upsert standup config / pause / resume | ❌ | owned teams | ✅ |
| Assign/unassign team managers | ❌ | ❌ | ✅ |
| Change a user's global role | ❌ | ❌ | ✅ |

"Owned teams" = teams for which the manager has a `team_managers` row.

## 5. Data model

New enum and two new tables (Drizzle, in [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)).

```
user_role  ENUM('viewer', 'manager', 'admin')

app_users
  slack_user_id   text PRIMARY KEY          -- Slack user_id (session `user.id` / sub)
  email           text
  display_name    text
  avatar_url      text
  role            user_role NOT NULL DEFAULT 'viewer'
  created_at      timestamptz DEFAULT now()
  last_login_at   timestamptz

team_managers
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE
  slack_user_id   text NOT NULL REFERENCES app_users(slack_user_id) ON DELETE CASCADE
  created_at      timestamptz DEFAULT now()
  UNIQUE(team_id, slack_user_id)
```

`app_users` is keyed by Slack user_id for consistency with `team_members` and
`slack_user_tokens`. It is distinct from `team_members`: `team_members` = who reports in a
standup; `team_managers` = who administers a team from the dashboard. Name/email/avatar are
captured from the Slack profile at login so the People page renders without extra Slack calls.

## 6. Auth & enforcement

### 6.1 Provisioning + bootstrap

A `signIn` callback in [`auth.ts`](../../apps/web/auth.ts) (Node runtime — Drizzle/postgres
cannot run in the edge `auth.config.ts` used by middleware) upserts the `app_users` row on
every login:

- Insert if missing; always refresh `display_name` / `email` / `avatar_url` / `last_login_at`.
- **Bootstrap rule:** if `SELECT count(*) FROM app_users WHERE role = 'admin'` is `0`, set this
  user's role to `admin`; otherwise a newly-inserted user defaults to `viewer`. Existing users
  keep their role.

This is safer than "literally the first login wins": it self-heals if a viewer is somehow
created first, and stops auto-promoting the instant an admin exists.

### 6.2 Authorization helpers (`apps/web/lib/authz.ts`)

- `getCurrentUser()` → session (`auth()`) joined with the `app_users` role; `null` if no session.
- `requireUser()` → returns the current user or redirects to `/login`.
- `requireAdmin()` → throws / 403 if `role !== 'admin'`.
- `canEditTeam(user, teamId)` → `true` if `role === 'admin'` OR (`role === 'manager'` AND a
  `team_managers` row exists for `(teamId, user.slackUserId)`).
- `requireTeamEdit(teamId)` → throws / 403 if `!canEditTeam`.

Role is looked up fresh from the DB per guarded request (one small indexed query), so
promotions/demotions and manager (re)assignments take effect immediately without re-login.

### 6.3 Server-action guards (the real boundary)

Server actions are directly invocable, so they are the enforcement boundary — UI hiding is
cosmetic. Each existing mutation gets a guard at the top:

| Server action | File | Guard |
|---|---|---|
| `createTeam` | `app/(dashboard)/teams/new/page.tsx` | `requireAdmin()` |
| `addMemberAction` / `setPermAction` / `removeAction` | `app/(dashboard)/teams/[id]/page.tsx` | `requireTeamEdit(id)` |
| `saveAction` / `toggleActiveAction` | `app/(dashboard)/teams/[id]/standup/page.tsx` | `requireTeamEdit(id)` |
| set user role (new) | People page | `requireAdmin()` + last-admin guard |
| assign/unassign manager (new) | team detail page | `requireAdmin()` |

**Last-admin guard:** changing a role away from `admin` (or any operation that would drop the
admin count to 0) is rejected, so an install can never become locked out.

## 7. UI changes

- **New admin-only People page** (`/people`): lists `app_users` with a role dropdown per user;
  loader and action both `requireAdmin()`. Enforces the last-admin guard. Nav link shown only
  to admins.
- **Team detail page** (`/teams/[id]`): a "Managers" section (admin-only) to assign/remove
  managers for that team; the assignment dropdown lists users whose role is `manager`. Existing
  edit controls (add member, set perms, standup config link) render only when `canEditTeam` is
  true; viewers and non-owning managers see a read-only view.
- **Standup config page** (`/teams/[id]/standup`): edit form rendered only when `canEditTeam`;
  otherwise read-only.

## 8. Migration

One Drizzle migration adds the `user_role` enum + `app_users` + `team_managers`. No data
backfill: roles populate via bootstrap/auto-provision on next login. On an existing install the
first admin to log in after deploy becomes `admin` (zero admins exist at that moment); all
subsequent logins become viewers until promoted.

## 9. Testing & Definition of Done

**Tests:**
- Unit — `canEditTeam` matrix (viewer/manager/admin × owned/unowned team), bootstrap logic
  (zero-admins → admin, admins-exist → viewer, existing user keeps role), last-admin guard.
- Integration — each guarded server action rejects an unauthorized caller and accepts an
  authorized one; manager can edit owned team but not an unowned one.
- Extend `smoke:phase2` with an RBAC scenario.

**Definition of done** (per [CLAUDE.md](../../CLAUDE.md) /
[testing-and-local-dev](../02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)):
1. `smoke:phase2` green in CI (unit + integration).
2. Live smoke runbook walked once against a real Slack dev workspace.
3. **Root [`README.md`](../../README.md) updated** — tick the RBAC feature-checklist item;
   document the three tiers, bootstrap behavior, and how a self-hoster promotes managers/admins.
4. ContextDB updated — mark Phase 2-D done in [`phase-2-backlog.md`](../todos/phase-2-backlog.md),
   add an ADR for the role model under `03_decisions/`, update
   [`data-model.md`](../02_architecture/data-model.md) with the two new tables.
