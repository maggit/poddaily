# ADR: End-to-end smoke per phase via a Slack stub (+ live checklist)

- **Date:** 2026-06-14
- **Status:** Accepted

## Context

Every phase must be verifiable end-to-end ("does this slice actually work?"), not just by
unit tests. The whole poddaily pipeline terminates at Slack — an external, stateful,
rate-limited service — so an E2E smoke must decide what stands in for Slack. Options:

1. **Stub only** — fully mock the Slack boundary. Deterministic and CI-friendly, but real
   Slack quirks (scopes, Block Kit rendering, threading) go unverified.
2. **Real workspace only** — run against a Slack dev workspace via a tunnel. Most faithful
   but flaky, slow, needs secrets, can't run in CI.
3. **Hybrid** — automated stub-based smoke for the full DB→API→worker pipeline, plus a short
   manual runbook against a real workspace before each phase ships.

## Decision

Use the **hybrid** (option 3). The automated `pnpm smoke:phaseN` drives the real
API/worker/DB code through a **Slack stub** injected at the `packages/slack-client` boundary
via `SLACK_API_BASE_URL`. A documented **live smoke runbook** validates one real standup
against a Slack dev workspace before a phase is declared done.

Local Postgres for dev and smoke uses the **Supabase CLI** local stack for prod parity;
Redis runs as a local container.

## Consequences

- Each phase owns explicit smoke scenarios with pass criteria; the sequence of a phase's
  scenarios **is** its end-to-end test (see
  [testing & local dev](../02_architecture/testing-and-local-dev.md)).
- CI runs unit + integration + `smoke:phaseN` with no secrets — deterministic.
- The Slack stub records outbound Web API calls and injects signed inbound `message.im`
  events, so the real signature-verification and conversation code paths run.
- `packages/slack-client` must honor `SLACK_API_BASE_URL` so the same code points at the stub
  in smoke and at `slack.com` in prod.
- "Done" for a phase = automated smoke green in CI **and** the live runbook walked once.
- Cost: maintaining the stub and keeping it faithful to the subset of Slack APIs we use.

## Alternatives considered

- **Stub only** — rejected: never exercises real Slack rendering/scopes before prod.
- **Real workspace only** — rejected: not CI-able, flaky, secret-dependent.
