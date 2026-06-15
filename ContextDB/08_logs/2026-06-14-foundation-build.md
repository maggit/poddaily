# 2026-06-14 — Foundation Build (Phase 1, Step 1)

Executed the [Foundation plan](../todos/2026-06-14-phase1-step1-foundation-plan.md) via
subagent-driven development (fresh implementer per task + spec/quality review) on branch
`phase1-foundation`.

Scaffolded the pnpm monorepo; added `packages/shared` (date interpolation + question types,
unit-tested) and `packages/db` (Drizzle schema for all 7 tables incl. the deltas — per-member
`timezone`, `slack_user_tokens`, `standup_reports.status` — plus client, first migration,
idempotent seed, and `smoke:db`). Local infra: Redis compose + Supabase CLI local Postgres.

## Verification
- `pnpm test` green: `packages/shared` date tests (3) + `packages/db` schema-applies test (1).
- `pnpm db:migrate && pnpm seed && pnpm smoke:db` → `✓ smoke:db PASSED — schema + seed + connectivity OK` (exit 0).
- Negative check: `smoke:db` against an empty DB exits non-zero with missing-table messages.

## Notable decisions / fixes during build
- pnpm pinned to the installed `10.28.2` (plan said 9.0.0).
- Added `@types/node` (referenced by `tsconfig.base.json`).
- `createDb` uses `prepare: false` (required for the Supabase transaction-mode pooler) and is
  documented as call-once-per-process.
- Seed made idempotent (`onConflictDoNothing`) so the migrate→seed→smoke flow is re-runnable.
- `docker-compose.yml` uses the standard Redis port `6379` for portability (a local collision
  with another project was handled per-machine, not committed).

## Environment notes
- Supabase CLI installed via Homebrew (`supabase 2.106.0`); local Postgres on `:54322`.
- `psql` is not installed; ad hoc DB checks used the postgres.js client instead.

## Definition of Done
Foundation establishes infra, not a user-facing feature, so no README feature-checklist items
were ticked. README quick start updated to the commands that work today; `pnpm dev` /
`smoke:phase1` noted as arriving in later steps. ContextDB context current.

Next: build-order step 2 — Slack app manifest + bot install + admin NextAuth login (`smoke:auth`).
