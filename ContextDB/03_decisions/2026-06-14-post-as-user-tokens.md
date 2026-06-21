# ADR: Post reports as the user via Slack user tokens

- **Date:** 2026-06-14
- **Status:** Accepted — implemented in Step 6b
  ([build log](../08_logs/2026-06-20-step6b-reporter-user-oauth.md))
- **Resolves:** PRD Open Question #1 (blocking)

## Context

Reports must appear in the team channel attributed to the reporting user (matching the
reference UX). Slack offers two ways:

1. **`chat:write.customize`** — the bot posts with a `username`/`icon_url` override that
   surfaces the user's name and avatar. No per-user OAuth. The post is still authored by the
   bot under the hood.
2. **User tokens** — each reporter completes a user-OAuth granting poddaily a user token;
   the report is posted *as the actual user*.

The PRD recommended option 1 as the pragmatic v1 path.

## Decision

Use **user tokens** (option 2). Reports are posted as the actual Slack user.

## Consequences

- Each **reporter** (not just admins) completes a one-time user-OAuth granting `chat:write`.
  Flow: `/api/slack/install` → `/api/slack/oauth/callback`.
- New `slack_user_tokens` table stores the token **encrypted at rest** (AES-GCM, key derived
  from `INTERNAL_API_SECRET`).
- **First-DM bootstrap:** members without a token get a one-time "connect" action in the
  bot's intro. Until connected, broadcast **gracefully degrades** to `chat:write.customize`
  (bot posts with the user's name/avatar), logged as degraded — so option 1 remains the
  fallback, not a dead end.
- Higher fidelity (true authorship, threading, edit/delete as the user) at the cost of an
  onboarding step and token custody.

## Alternatives considered

- **`chat:write.customize` only** — simpler, no token store, but posts are bot-authored and
  don't match the "as me" expectation as faithfully. Retained as the fallback path.
