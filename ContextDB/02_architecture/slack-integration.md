# Slack Integration

poddaily touches Slack through **three distinct surfaces**. Keeping them separate avoids
conflating admin identity, reporter posting rights, and bot messaging.

## 1. Admin authentication (NextAuth)

- The **web** app uses NextAuth v5 with Slack OIDC (`openid`, `email`, `profile`).
- Purpose: identify and authorize admins for the dashboard. Nothing more.
- Phase 1 RBAC default: anyone who completes this OAuth is an admin (PRD Q3 open; tiers
  deferred).

## 2. Reporter user-OAuth (post-as-user)

Driven by the [post-as-user ADR](../03_decisions/2026-06-14-post-as-user-tokens.md).

- Separate install link: `GET /api/slack/install` → Slack consent → `GET /api/slack/oauth/callback`.
- Requests a **user token** with `chat:write` so poddaily can post a report *as that user*.
- The callback stores the encrypted token in `slack_user_tokens`.
- **First-DM bootstrap:** when the bot DMs a member who has no token on file, the intro
  message includes a one-time "Connect so I can post as you" button linking to the install
  flow. Until connected, broadcast **gracefully degrades** to bot-posting the report with the
  user's name/avatar surfaced (logged as `degraded=true`).

## 3. Bot (Bolt)

The Slack app **"poddaily"** ([new-app ADR](../03_decisions/2026-06-14-new-slack-app.md))
runs `@slack/bolt`.

### Bot token scopes
`chat:write`, `chat:write.customize` (fallback posting), `im:write`, `im:history`,
`users:read`, `users:read.email`, `channels:read`, `channels:history`, `groups:read`,
`commands` (slash command reserved for P1).

### Event subscriptions
`message.im` — receives DM replies from users.

### Manifest
`app_manifest.yaml` committed to the repo; the app is registered as "poddaily".

## DM Q&A engine

> **Status — implemented in Step 5b.** The engine ships as `apps/api` (a Bolt service
> receiving `message.im`) delegating to `handleMessage`, which drives the pure `advanceReport`
> reducer in `packages/shared`. `skip` / `skip all` are shipped; on completion the outro is
> posted to the DM. Still pending: the 4h timeout sweep (Step 7) and the channel broadcast
> (Step 6) — in 5b a completed report posts the outro to the DM only.

State is **reconstructed from Postgres** on every event — no separate state store. See
[stateless DM ADR](../03_decisions/2026-06-14-stateless-dm-state.md) and the
[DM state machine diagram](../07_diagrams/dm-state-machine.mmd.md).

Flow for one member:
1. `send-standup-dm` opens a DM, interpolates `{last_report_date}` into Q1, posts intro + Q1,
   inserts an `in_progress` `standup_reports` row with empty `answers` and the `dm_thread_ts`.
2. On each `message.im`:
   - Look up the member's open `in_progress` report for today's run.
   - Count answered questions → that index is the current question.
   - Handle control words: `skip` records an empty/"(skipped)" answer and advances;
     `skip all` marks the report `timed_out`/aborted and ends without posting.
   - Otherwise append `{question_id, question_text, answer}` to `answers`.
   - If more questions remain → post the next question. Else → mark `completed`, post outro,
     trigger **broadcast**.
3. Idempotency: because progress is derived from stored `answers`, a duplicated/redelivered
   event maps to the same question index and does not double-advance.

## Channel broadcast

> **Status — implemented in Step 6a.** The worker posts the opening message at run-open (with a
> live `Reported: n out of total` counter, stored on `standup_runs.channel_opening_ts`); the api
> posts each completed report as a threaded reply via `chat:write.customize` (bot posts with the
> member's name/avatar) and updates the counter. True post-as-user (user-token) authorship is
> pending **Step 6b** — 6a's name/avatar path is the permanent fallback. The bot must be a member
> of the team channel or `chat.postMessage` returns `not_in_channel` (logged as `[broadcast]
> degraded`); the broadcast is best-effort and never reverts the completed report.

Per the [Slack message format](../01_specs/poddaily-prd.md#slack-message-format).

1. **Opening thread message** — posted once per run to the team channel by the bot:
   ```
   📋 *Daily Standup — {date}*
   Find all reports for *Daily Standup, {date}* in this thread.
   Reported: {n} out of {total}
   ```
   Its `ts` is stored on the run for threading.
2. **Individual report** — a threaded reply (`thread_ts` = opening message ts) built with
   Block Kit (header section + divider + one section per Q&A pair), posted with the
   **user's token** so Slack attributes it to the user. The resulting `ts` is saved to
   `standup_reports.channel_post_ts`.
3. If the user has no token → fallback to `chat:write.customize` (bot posts with the user's
   `username`/`icon_url`), logged as degraded.

## Failure & edge handling

- **DM send failures** retry 3× with exponential backoff (BullMQ).
- **Timeout** — reports left `in_progress` after 4 hours become `timed_out`; partials never
  post to the channel.
- **Signature verification** — `/api/slack/events` and `/api/slack/interactions` verify the
  Slack signing secret before processing.
