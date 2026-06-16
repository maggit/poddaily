# ADR: Admin CRUD via Next.js server-side; Hono API reserved for Slack/worker

- **Date:** 2026-06-16
- **Status:** Accepted

## Context

The [API spec](../01_specs/poddaily-prd.md#api-spec) lists REST endpoints (`/api/teams`, etc.)
under the Hono.js service (`apps/api`). But the admin UI (`apps/web`, Next.js, already built
in Step 2) is itself a server-rendered app that can read/write the database directly. Standing
up `apps/api` now — with cross-service auth, CORS, and deployment — just to serve admin CRUD
would add moving parts before they're needed.

We need to decide where the admin team/member/standup CRUD lives for Step 3+.

## Decision

- **Admin CRUD is served by `apps/web` itself** — Next.js **route handlers** (`app/api/*`) and
  **server actions**, calling `@poddaily/db` directly. The admin session (NextAuth) authorizes
  these; no separate service hop.
- **`apps/api` (Hono) is reserved for the Slack-facing and worker-facing surface** — Slack
  Events/interactions, OAuth install/callback, and the internal worker↔api endpoints
  (`/internal/*`). It is introduced when those land (Steps 5–6), not before.

## Consequences

- Step 3 (team + member CRUD) ships without standing up `apps/api` — faster, fewer seams.
- `@poddaily/web` gains a dependency on `@poddaily/db` (and `@poddaily/shared`); the DB client
  is created once per server process (see `createDb` reuse note).
- Data access for the admin app is colocated with the admin UI — a standard Next.js pattern.
- The PRD's REST paths still hold conceptually; some are simply implemented as Next route
  handlers in `apps/web` rather than Hono routes. When `apps/api` lands, the Slack/worker
  endpoints live there; admin CRUD stays in web unless a reason emerges to extract it.
- Two places can touch the DB (web for admin, api/worker for Slack) — both import the same
  `@poddaily/db` schema, so there's a single schema source of truth.

## Alternatives considered

- **Build `apps/api` (Hono) now and have web call it** — matches the API spec literally, but
  adds cross-service auth/CORS/deploy overhead before the Slack/worker surface needs it.
- **Everything in Hono, web is a thin client** — more service separation than an internal
  admin tool needs at this stage; revisit only if web-side data access becomes a problem.
