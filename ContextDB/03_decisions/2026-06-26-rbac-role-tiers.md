# ADR: RBAC Role Tiers — Three DB-backed Tiers with First-Login Bootstrap

- **Date:** 2026-06-26
- **Status:** Accepted

## Context

Before Phase 2-D, anyone who completed admin Slack OAuth was a full admin: the `authorized`
callback in `auth.config.ts` admitted any authenticated Slack user and no server action checked
anything beyond session existence. The [PRD (Q3)](../01_specs/poddaily-prd.md) called for role
tiers gating who can edit teams and standups. The [Phase 2-D spec](../01_specs/phase-2-d-rbac-spec.md)
captures the full design; this ADR records the key decisions and the alternatives rejected.

## Decisions

### 1. Three tiers: viewer / manager / admin

**Choice:** three global role tiers backed by a `user_role` enum in the DB:

| Role | Permissions |
|---|---|
| **viewer** | Read-only — view dashboard, reports, standup config |
| **manager** | Viewer + edit/configure the teams they own |
| **admin** | Everything — create teams, edit any team, assign roles, assign managers |

A three-tier model maps cleanly to the actual operational pattern (reporters / team leads /
platform admins) without over-engineering fine-grained ACLs that the tool doesn't need yet.

### 2. Roles stored in `app_users` (DB-backed, not env-configured)

**Choice:** a new `app_users` table keyed by `slack_user_id` holds each admin-portal user's
role. The role is the DB source of truth — editable via the admin UI.

### 3. Bootstrap: first login while zero admins exist → admin

**Choice:** on each login the `signIn` callback upserts the `app_users` row. If the count of
existing admins is 0, this login is promoted to `admin`; otherwise a new user defaults to
`viewer`. Existing users keep their stored role (the upsert refreshes profile fields only, not
role).

This "zero-admins rule" is safer than a literal "first user ever" rule: it self-heals if a
viewer row exists in the DB at the time of first login, and auto-promotion stops the moment any
admin exists.

### 4. Auto-provision new logins as viewer

**Choice:** any Slack user who authenticates via the admin OAuth flow and has no `app_users`
row is provisioned as `viewer` (unless the bootstrap rule fires). Viewers can browse the
dashboard and reports without needing explicit invitation — they just can't mutate anything.

### 5. Manager scope via `team_managers` many-to-many join table

**Choice:** a `team_managers` join table (`team_id`, `slack_user_id`) records which managers
own which teams. This gives each manager an arbitrarily large or small team portfolio without
schema changes.

### 6. Role evaluated fresh from DB per request (not baked into the JWT)

**Choice:** guarded server actions call `getCurrentUser()` which reads the `app_users` row
from the DB on every request. The session JWT carries the Slack identity but not the role.

This means role promotions and demotions take effect immediately — no re-login, no token
rotation, no cache invalidation needed.

### 7. Two-step manager assignment

**Choice:** becoming a team manager requires two separate admin actions:
1. Promote the user to the `manager` role on the People page.
2. Assign them to specific teams in each team's Managers section.

Keeping the two steps explicit prevents accidental "manager everywhere" grants and makes the
assignment surface in the UI predictable.

## Alternatives considered

### Env-var allowlist for admins

Allow an `ADMIN_SLACK_IDS=U123,U456` env var to gate admin access. Rejected: requires
redeployment for every role change, awkward to manage at scale, and doesn't model manager-tier
ownership at all.

### Binary allowlist (admin vs. everyone else)

Keep a single admin role and expose a flag for "edit this team" without a manager tier.
Rejected: doesn't support the delegation pattern where a team lead manages their own pod
without needing full admin powers.

### Single-owner column on `teams`

Add `manager_slack_user_id TEXT` to the `teams` table. Rejected: one-to-one — a team can only
have one manager, and a manager must be listed per-team rather than once. `team_managers` is a
straightforward extension when ownership is inherently many-to-many.

### JWT-baked role

Store the role in the session JWT so that DB isn't hit on each guarded request. Rejected: role
changes require a session refresh (re-login), which is a poor UX for an admin promoting another
user and immediately expecting the change to take hold. The per-request DB read is a single
indexed lookup — negligible cost.

## Consequences

- Every guarded server action now calls `getCurrentUser()` (one indexed DB read) before
  proceeding. The overhead is small and the correctness gain is high.
- The People page and team-level Managers section are new admin-only surfaces.
- The `app_users` table is distinct from `team_members`: `team_members` are standup reporters;
  `app_users` are dashboard administrators. A person can be both.
- The last-admin guard (rejecting a demotion that would drop admin count to 0) prevents lockout.
- On an existing install after the migration, the first user to log in while the `app_users`
  table has no admin rows is promoted to `admin`; everyone else becomes `viewer` until promoted.
