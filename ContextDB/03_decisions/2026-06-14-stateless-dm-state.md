# ADR: Stateless DM conversation state (reconstructed from Postgres)

- **Date:** 2026-06-14
- **Status:** Accepted

## Context

The bot asks one question at a time in a DM and must know, on each incoming `message.im`,
which question the user is answering. We can either keep per-conversation state in Redis or
derive it from the persisted answers in Postgres.

## Decision

Keep **no separate conversation-state store**. On each event, reconstruct progress from the
user's open `standup_reports` row — the number of entries in `answers` is the current
question index.

## Consequences

- `standup_reports.answers` (JSONB) is the **single source of truth** for progress;
  `standup_reports.status` (`in_progress | completed | timed_out`) tracks lifecycle.
- **Durable across restarts** — a worker/api restart loses no conversation state.
- **Idempotent** — a redelivered Slack event maps to the same question index and does not
  double-advance.
- One fewer moving part to reconcile (no Redis/Postgres divergence). Redis is still used for
  the BullMQ queue, just not for conversation state.
- Slightly more DB reads per message; negligible at standup volumes.

## Alternatives considered

- **Redis state machine keyed by thread** — faster reads, but a second source of truth to
  reconcile with Postgres, plus extra failure modes (eviction, TTL, restart loss).
