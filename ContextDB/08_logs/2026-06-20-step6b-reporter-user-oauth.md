# 2026-06-20 — Step 6b Build: Reporter User-OAuth (Post-as-User)

Executed the [Step 6b plan](../../docs/superpowers/plans/2026-06-20-step6b-reporter-user-oauth.md)
(spec: [design doc](../../docs/superpowers/specs/2026-06-20-step6b-reporter-user-oauth-design.md))
on branch `feat/step6b-reporter-user-oauth`. Connected members' standup reports are now posted to
the team channel **as the actual user** (their own Slack user token) — a true user message with
**no "APP" badge**, counted as a user message in Slack analytics. Unconnected members fall back to
the 6a bot post (`chat:write.customize`) plus a "Connect to post as yourself" nudge. This completes
the [post-as-user ADR](../03_decisions/2026-06-14-post-as-user-tokens.md).

## What shipped

- **`@poddaily/shared` — AES-GCM token crypto.** Pure encrypt/decrypt helpers for the user
  token (key derived from `INTERNAL_API_SECRET`), no DB / no Slack — unit-tested.
- **`@poddaily/db` — encrypted token store.** `slack_user_tokens` save/get/has: tokens stored
  encrypted at rest; `has` is an existence check that never decrypts.
- **HMAC-signed OAuth state.** Signed/verified state param threaded through the install →
  callback round-trip to bind the flow to the member and resist tampering.
- **Web routes `/api/slack/install` + `/api/slack/oauth/callback` (apps/web).** `install`
  redirects to Slack consent for the `chat:write` user scope; `callback` exchanges the code,
  encrypts the resulting user token, and persists it via the store.
- **Worker — Connect button in the DM intro.** Unconnected members (existence check only — the
  worker never decrypts) get a one-time "Connect to post as yourself" button in their standup DM
  linking to the install flow.
- **api — post-as-user broadcast.** On report completion the api posts the threaded report via a
  per-user ephemeral `createSlackClient({ token })` using the member's user token (true
  authorship, no override). Degrades to the 6a `chat:write.customize` bot post + Connect nudge on
  no-token / decrypt-failure / post-failure.
- **slack-stub — oauth fakes + Bearer recording.** The stub fakes the OAuth code exchange and
  records the Bearer token on `chat.postMessage`, so smoke can assert which token posted.
- **`smoke:standup` post-as-user assertion.** The full outbound→inbound smoke now asserts the
  completed report posted with the `xoxp` user token.

## Verification

- `pnpm test`: **26 files / 104 tests passing** (unit + integration, including the
  `smoke:standup-outbound` suite that runs as part of the default `vitest` run).
- `pnpm smoke:standup`: green — the completed report posted with the member's `xoxp` user token
  (true post-as-user authorship asserted via the stub's recorded Bearer token).

## Notable decisions / scope

- **User token = true authorship — the whole point.** Posting with the member's own `chat:write`
  user token makes the report a real user message: no "APP" badge, counted in Slack analytics.
  This is what 6b buys over 6a's name/avatar surface.
- **`chat:write.customize` is the documented fallback.** Unconnected members (or any
  decrypt/post failure) keep the 6a name/avatar bot post — never a dead end.
- **Per-user ephemeral client.** The api builds a `createSlackClient({ token })` per member from
  the decrypted user token rather than reusing a shared bot client.
- **Worker existence-only.** The worker decides whether to show the Connect button via the store's
  `has` check; it **never decrypts** a token. Decryption + posting live only in the api.
- **Crypto in shared, store in db.** Pure AES-GCM helpers live in `@poddaily/shared`; the
  encrypted `slack_user_tokens` save/get/has live in `@poddaily/db`.
- **HMAC-signed OAuth state** binds the install → callback round-trip and resists tampering.
- **Fallback triggers.** Broadcast degrades to bot-post + nudge on **no token on file**,
  **decrypt failure**, or **post failure** — each isolated, never reverting the completed report.
- **vitest `@/` alias.** vitest ignores the `@/` path alias, so the web routes import
  `lib/oauth-state` relatively for tests to resolve it.
- **`INTERNAL_API_SECRET` now required on the `api` service.** In addition to web/worker, the api
  needs it to decrypt stored user tokens before posting.

## Definition of done — honest status

- Automated `smoke:standup` (+ unit + integration) green in CI — ✓ (26 files / 104 tests).
- Root `README.md` ticked ("Channel broadcast posted as the user" box now checked — 6b completes
  it) + `ContextDB/` updated (slack-integration status note, getting-started 6b note, ADR status,
  this log) — ✓.
- **Live smoke runbook against a real Slack dev workspace — NOT yet walked.** Connecting a real
  user, then verifying the channel report carries **no "APP" badge**, has not been validated
  against a real workspace. The `chat:write` user-scope app config, the
  `${web}/api/slack/oauth/callback` redirect URL, and the **member-must-be-in-channel**
  requirement are pending human/operator steps.

So Step 6b is **CI-green and documented, but NOT yet live-verified**. The per-phase Definition of
Done is not complete until a human operator connects a real user and confirms the post-as-user
report renders with no "APP" badge.

## Out of scope (not done in 6b)

- Token rotation / refresh.
- A standalone web connections page (members connect via the DM Connect button only).
- 4h timeout sweeper → **Step 7**.
