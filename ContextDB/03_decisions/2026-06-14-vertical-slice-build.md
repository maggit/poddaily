# ADR: Vertical-slice build order

- **Date:** 2026-06-14
- **Status:** Accepted

## Context

Phase 1 Core spans a monorepo (web, api, worker) plus Slack, Postgres, and Redis. We need a
build sequence. Options: vertical slice (one feature end-to-end first), layer-by-layer (all
db, then all api, then all worker, then Slack), or a Slack-first throwaway spike.

## Decision

Build a **vertical slice** first: a minimal monorepo, then one feature driven end-to-end
through every layer — create a team → add a member → configure standup → scheduler fires →
bot DMs → user answers → posts to channel.

## Consequences

- The riskiest integration points (Slack user-token OAuth, the DM state machine, per-user-TZ
  scheduling) are exercised in week 1, not at the end.
- A demoable channel thread exists early; each subsequent step adds breadth, not new seams.
- Build order:
  1. Monorepo scaffold + `packages/db` + `packages/shared`
  2. Slack manifest + bot install + admin NextAuth
  3. Team create + add member (captures TZ)
  4. Standup config
  5. Scheduler → `send-standup-dm` → DM Q&A engine
  6. Reporter user-OAuth + post-as-user broadcast + threading
  7. Timeout / skip / retry

## Alternatives considered

- **Layer-by-layer** — cleaner per-layer mental model, but Slack integration risk lands last
  and nothing is demoable until the end.
- **Slack-first spike** — fastest UX validation but throwaway work and a messy retrofit seam.
