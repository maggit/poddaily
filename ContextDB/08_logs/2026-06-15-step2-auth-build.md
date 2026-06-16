# 2026-06-15 — Step 2 Build: Slack Manifest + Admin Auth

Executed the [Step 2 plan](../todos/2026-06-15-phase1-step2-auth-plan.md) via subagent-driven
development (fresh implementer per task + review on the load-bearing tasks) on branch
`phase1-step2-auth`.

Added `apps/web` (Next.js **15.5.19**, Tailwind + shadcn, dark) with a `/login` page and a
protected `(dashboard)`. Wired **NextAuth v5 (`5.0.0-beta.31`)** with a stubbable Slack OIDC
provider (`SLACK_OIDC_BASE`), JWT sessions, and route-protection middleware. Added
`app_manifest.yaml` and a `tools/slack-stub` OIDC stub. `smoke:auth` green.

## Verification
- `pnpm test` green: **11 tests / 5 files** (shared dates, db schema, slack-profile, slack-stub, auth-smoke).
- `pnpm smoke:auth` green: stub exchange → mapped session user; no-session ⇒ not authorized (5 tests).
- `pnpm --filter @poddaily/web build` succeeds; dev server: `/login` 200, `/dashboard` → `/login` when signed out.

## Notable decisions / fixes during build
- **Pinned Next.js to 15** — `create-next-app@latest` pulled Next 16; re-scaffolded on
  `create-next-app@15` to match the spec and NextAuth v5 compatibility.
- shadcn init produced the Tailwind-v4 "base-nova" (Base UI) Button variant rather than the
  Radix default — functionally fine; noted for future components.
- Import-style rule: files imported by both Next and Vitest (`auth.config.ts`, `auth.ts`,
  `middleware.ts`) use relative imports, not the `@/` alias (root Vitest can't resolve `@/`).
- NextAuth v5 reads `AUTH_SECRET` — added it to `.env.example` alongside `NEXTAUTH_SECRET`.
- Added `tools/*` to the workspace globs and `tools/**/*.test.ts` to the Vitest include.

## Scope boundary (documented, not a gap)
Automated `smoke:auth` covers the deterministic core: the stub identity → mapped session
user, and the route-protection decision (`authorized` returns false without a session ⇒
NextAuth redirects to `/login`). The full browser OAuth redirect dance is validated by the
live runbook against a real Slack dev workspace, not in CI.

## Known follow-up
The `authorized` callback admits any authenticated Slack user — this matches the Phase 1 RBAC
default ("admin = anyone who can Slack-OAuth", [PRD Q3](../01_specs/poddaily-prd.md#open-questions),
deferred). Tightening to an email/workspace allowlist is the follow-up before real admin gating.

Next: build-order step 3 — team create + add member (captures TZ) (`smoke:team`).
