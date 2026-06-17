# 2026-06-16 — Step 3 Part 2 Build: Team & Member CRUD

Executed the [Step 3 Part 2 plan](../todos/2026-06-16-phase1-step3b-team-crud-plan.md) via
subagent-driven development on branch `phase1-step3b-team-crud`. Real admin CRUD, per the
[admin-CRUD ADR](../03_decisions/2026-06-16-admin-crud-via-next-server.md).

- **DB wired into web:** `@poddaily/db` singleton (`apps/web/lib/db.ts`), data-access layer
  (`apps/web/lib/teams.ts`: list/get/create teams, list/add/update-perms/remove members),
  TDD'd. Timezone shortlist added to `@poddaily/shared`.
- **UI (design system, semantic classes only):** teams list page with a `DataTable` primitive
  and member counts; create-team form + Server Action; team detail page with a member table
  (View/Report/Edit permission toggles + remove) and an add-member form that captures an IANA
  timezone. All via Next Server Components + Server Actions.
- **`smoke:team`** green — full create → add member (TZ) → toggle perms → remove path.

## Verification
- `pnpm test`: 16 pass (added 5 teams tests).
- `pnpm smoke:team`: green.
- `pnpm --filter @poddaily/web build`: success.

## Notable fix during build
`drizzle-orm` declares `react` as an optional peer; adding it as a direct `apps/web` dep
created a second peer-keyed copy distinct from `@poddaily/db`'s, breaking the web build with a
duplicate-type error. Fixed architecturally: `@poddaily/db` now **re-exports the Drizzle
operators** (`eq`, `and`, …); the web app imports them from `@poddaily/db` and no longer
depends on `drizzle-orm` directly — one ORM instance.

## Notes
- `next build` initializes the DB singleton at import, so it needs `DATABASE_URL` set
  (`apps/web/.env.local`, gitignored, for local builds; real env in CI/prod).
- The teams UI is behind admin login — visible after Slack auth (live runbook). `smoke:team`
  proves the CRUD against the DB without Slack.

## Scope note
Member add is a manual form (display name, Slack user id, timezone); Slack-workspace member
search + automatic TZ capture from `users.info` land with the bot (`users:read`) in a later
step. The data model stores `timezone`, so it's captured today.

Next: build-order step 4 — standup configuration (questions + schedule) (`smoke:config`).
