# ADR: Supabase as managed Postgres (database only)

- **Date:** 2026-06-14
- **Status:** Accepted

## Context

The PRD lists the database as "PostgreSQL 16 (self-hosted pg or Supabase)". We need to pick
one and decide how much of Supabase we adopt. Supabase bundles Postgres with Auth, RLS,
storage, and realtime — but poddaily already specifies NextAuth v5 (Slack OAuth) for auth.

## Decision

Use **Supabase as the managed Postgres 16 database only**. Do **not** adopt Supabase Auth,
RLS, storage, or realtime. Auth stays in the app layer (NextAuth for admins; Slack user
tokens for reporters). Redis remains **self-hosted** (Supabase provides no Redis).

## Consequences

- **Drizzle ORM** unchanged; Supabase is just the Postgres endpoint.
- **Two connection URLs:**
  - `DATABASE_URL` — Supabase **pooler**, transaction mode, port 6543 — used by api/worker at
    runtime (safe with many short-lived connections).
  - `DIRECT_URL` — **direct** connection, session mode, port 5432 — used by `drizzle-kit` for
    migrations (transaction-mode pooler can't run migration DDL reliably).
- **`docker-compose` drops the `postgres` service and `pgdata` volume**; keeps `web`, `api`,
  `worker`, `redis`, and `redisdata`.
- **Token encryption stays app-side** (AES-GCM before insert) — using a managed DB does not
  change our at-rest stance for `slack_user_tokens`.
- Operational burden of Postgres (backups, upgrades, HA) shifts to Supabase.

## Alternatives considered

- **Self-hosted Postgres container** — full control, but we own backups/HA/upgrades; no
  benefit over managed for this workload.
- **Full Supabase stack (Auth + RLS)** — would duplicate/replace NextAuth and add RLS
  complexity for an internal-only tool; rejected to keep auth in one place.
