# ADR: New Slack app "poddaily"

- **Date:** 2026-06-14
- **Status:** Accepted (pending Security sign-off)
- **Resolves:** PRD Open Question #4 (blocking)

## Context

poddaily needs Slack bot scopes, event subscriptions, and OAuth. It could either be a new,
dedicated Slack app or be folded into an existing internal Slack app.

## Decision

Register a **new Slack app named "poddaily"** with its own `app_manifest.yaml` committed to
the repo.

## Consequences

- Clean separation of scopes, tokens, and event subscriptions from other internal tooling;
  least-privilege is easy to reason about.
- The manifest is version-controlled and reproducible; the app is registered as "poddaily".
- Bot scopes: `chat:write`, `chat:write.customize`, `im:write`, `im:history`, `users:read`,
  `users:read.email`, `channels:read`, `channels:history`, `groups:read`, `commands`.
- Event subscriptions: `message.im`. Slash command `/standup` reserved for P1.
- **Assumes Security sign-off** for a new first-party app. If Security prefers consolidation,
  revisit — the scope/event set is portable to an existing app.

## Alternatives considered

- **Add to an existing internal app** — potentially faster approval, but couples poddaily's
  lifecycle and scopes to an unrelated app and muddies least-privilege.
