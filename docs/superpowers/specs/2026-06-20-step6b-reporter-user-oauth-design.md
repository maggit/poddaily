# Step 6b — Reporter User-OAuth (Post-as-User) Design

- **Date:** 2026-06-20
- **Status:** Accepted (brainstorming)
- **Phase:** 1 Core, build step 6 (second half)
- **Predecessor:** [Step 6a — channel broadcast](../../../ContextDB/08_logs/2026-06-20-step6a-channel-broadcast.md)
- **Resolves:** [post-as-user ADR](../../../ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md)

## Summary

6a broadcasts each completed standup report to the team channel, but posts it with the **bot
token** + `chat:write.customize` (the bot wears the member's name/avatar). Slack still records
that as a **bot/app message** — it carries an "APP" badge and counts as a bot message in Slack
analytics.

6b adds a one-time **reporter user-OAuth** so each member grants poddaily a `chat:write` **user
token**. Connected members' reports are then posted **with their own user token** — Slack
attributes the message to the real user: no "APP" badge, counts as a user message, editable/
deletable by them. Members who haven't connected fall back to 6a's bot post **plus a "Connect to
post as yourself" nudge** (the chosen fallback), so the channel summary stays complete and the
gap is visible and self-correcting.

**Primary success criterion:** a connected member's threaded report appears in the channel with
**no "APP" badge** (true user authorship) — this is the visible proof that Slack counts it as a
user message. This is asserted in the smoke (via which token posted) and verified in the live
runbook (the badge).

## Why user tokens (not `chat:write.customize`)

Authorship is determined by **which token calls `chat.postMessage`**:

| | Token | Author | Slack analytics | "APP" badge |
|---|---|---|---|---|
| 6a | bot + `chat:write.customize` | the app | bot message | shows "APP" |
| 6b | the member's user token (`xoxp`) | the real user | **user message** | **none** |

No name/avatar override on the bot token changes the underlying author, so only the user-token
path satisfies the analytics requirement. 6a's path is retained strictly as the fallback for
un-connected members.

## Scope

**In scope (6b):** user-OAuth install/callback, AES-GCM token encryption + token store, the
"Connect" nudge (DM button + degraded-post nudge), and switching the broadcast to post with the
member's user token (falling back to the bot path). One step (~9 tasks).

**Out of scope:** token rotation/refresh (Slack `xoxp` tokens don't expire unless rotation is
enabled — not enabled here); a standalone web "connections" settings page (the DM button +
degraded-post nudge cover onboarding); the 4h timeout sweeper (→ Step 7).

## Decisions locked

1. **Per-user ephemeral client** for posting as the user — on broadcast, decrypt the member's
   token and construct a short-lived `createSlackClient({ token })`; no cached client pool, no
   new client method (YAGNI at standup volumes).
2. **Crypto in `packages/shared`, token store in `packages/db`.** The pure cipher is TDD'd in
   shared; the DB-touching token CRUD lives next to the `slack_user_tokens` table in db.
3. **Worker never holds the decryption key.** `sendDm` only needs to know *whether* a member is
   connected (to show the button) → a `hasUserToken` existence check (no decrypt). Only the
   **web** (encrypt on callback) and **api** (decrypt on broadcast) use `INTERNAL_API_SECRET`.
4. **Fallback = degraded + nudge** (the chosen option): unconnected members still get the bot
   post, with a "Connect to post as yourself" context block appended.
5. **Fallback on user-post failure:** if a stored token is invalid/revoked (`invalid_auth`,
   `token_revoked`), catch and fall back to the degraded bot path + nudge, logged. A report is
   never lost to a bad token.
6. **Opening message + counter stay bot-posted** — they're system messages, not user reports.
7. **Connect link built from `NEXTAUTH_URL`** (already set = the web domain). No new env var.

## Architecture & components

### 1. Token crypto — `packages/shared/src/crypto.ts` (pure, TDD)

```ts
encryptToken(plaintext: string, secret: string): string   // → base64(iv | authTag | ciphertext)
decryptToken(payload: string, secret: string): string     // inverse; throws on tamper/wrong key
```

- AES-256-GCM. Key = `scryptSync(secret, FIXED_SALT, 32)` (deterministic 32-byte key from
  `INTERNAL_API_SECRET`; a constant app-level salt is fine since the secret is the entropy).
- Random 12-byte IV per encryption (so the same token encrypts to different ciphertext each
  time). The GCM auth tag detects tampering/wrong key on decrypt.
- Pure (no I/O); tested by roundtrip (`decryptToken(encryptToken(x, k), k) === x`), wrong-key
  failure, and tamper failure.

### 2. Token store — `packages/db/src/tokens.ts`

```ts
saveUserToken(db, secret, { slackUserId, accessToken, scopes }): Promise<void>  // encrypts accessToken
getUserToken(db, secret, slackUserId): Promise<string | null>                   // decrypts → token or null
hasUserToken(db, slackUserId): Promise<boolean>                                  // existence only, no decrypt
```

Wraps the existing `slack_user_tokens` table (`slackUserId` pk, `accessToken` text = ciphertext,
`scopes`, `authedAt`). `saveUserToken` upserts (re-connect overwrites). Re-exported from
`@poddaily/db`.

### 3. OAuth routes — `apps/web` (Next.js route handlers)

Separate from the existing admin OIDC (`/api/auth/[...nextauth]`). New:

- `GET /api/slack/install/route.ts` → 302 redirect to
  `${SLACK_OAUTH_BASE}/oauth/v2/authorize?client_id=…&user_scope=chat:write&redirect_uri=${NEXTAUTH_URL}/api/slack/oauth/callback&state=${signedState}`.
  `state` = an HMAC (`INTERNAL_API_SECRET`) over a random nonce + issued-at, to defend the
  callback against CSRF/forged codes.
- `GET /api/slack/oauth/callback/route.ts` → verify `state` (HMAC + freshness) → POST
  `${SLACK_OAUTH_BASE}/api/oauth.v2.access` (`client_id`, `client_secret`, `code`, `redirect_uri`)
  → read `authed_user: { id, access_token, scope }` → `saveUserToken(...)` → render a minimal
  **"Connected ✅ — poddaily will post your standups as you"** HTML page.
- **Base-URL seam:** `SLACK_OAUTH_BASE` (default `https://slack.com`), mirroring the existing
  `SLACK_OIDC_BASE`, so the stub can fake `oauth/v2/authorize` + `oauth.v2.access` in tests.

### 4. Connect nudge (two surfaces)

- **DM intro (worker `sendDm`):** when `!hasUserToken(db, slackUserId)`, append a Block Kit
  actions block with a "Connect to post as yourself" button (url = `${NEXTAUTH_URL}/api/slack/install`)
  after the intro/Q1. The worker reads `NEXTAUTH_URL`; if unset, skip the button (degrade
  silently). `sendDm` already posts via the bot client — the button is just extra blocks.
- **Degraded channel post (api):** when broadcasting a report for an unconnected member (or after
  a token-post failure), append a small context block:
  `_Posted by poddaily — {name} hasn't connected. Connect to post as yourself: {link}_`.

### 5. Broadcast-as-user (api `broadcastReport`)

Replaces 6a's single bot post with:

1. `const token = await getUserToken(db, INTERNAL_API_SECRET, report.slackUserId)`.
2. **If `token`:** `const userSlack = makeUserSlack(token)` (a `createSlackClient({ token })`
   factory injected into deps for testability; it inherits `SLACK_API_BASE_URL` so the stub
   works). Post the threaded report with `userSlack.postMessage(channel, text, { threadTs, blocks })`
   — **no `username`/`iconUrl`** (true authorship). Save `channel_post_ts`.
   - On throw (`invalid_auth`/revoked) → fall through to the degraded path below (logged
     `[broadcast] user-token post failed; degrading`).
3. **Else (degraded):** the 6a bot path — `slack.postMessage(channel, text, { threadTs,
   username, iconUrl, blocks: [...reportBlocks, connectNudgeBlock] })`. Save `channel_post_ts`.
4. Either way, update the counter (bot client) as in 6a.

The counter recompute and opening message stay on the bot client.

### 6. Slack-stub + smoke

- **Stub:** add `GET /oauth/v2/authorize` (302 back to `redirect_uri?code=STUB_CODE&state=…`) and
  `POST /api/oauth.v2.access` (return `{ ok, authed_user: { id, access_token: "xoxp-stub-USER",
  scope: "chat:write" } }`). Record on `chat.postMessage` which **token** authenticated the call
  (the stub can read the `Authorization: Bearer` header) so the smoke can assert user-token vs
  bot-token posts. Reset clears it.
- **smoke:** (a) connected path — seed a token via `saveUserToken(db, secret, { slackUserId, …})`
  (the OAuth route end-to-end is covered separately by the web callback test, below), complete a
  standup, assert the threaded report was posted with the **user token** (`xoxp-…`) and
  `channel_post_ts` set; (b) unconnected path — no token, complete a standup, assert the report
  posted with the **bot token** and the post blocks include the Connect nudge.

## Data flow

```
Connect: member clicks Connect (DM button / degraded-post link)
  → GET /api/slack/install → Slack consent → GET /api/slack/oauth/callback
  → oauth.v2.access → saveUserToken (encrypted)  → "Connected ✅"

Report: member completes Q&A (api)
  → getUserToken(slackUserId)
     ├─ token  → post threaded reply AS THE USER (user token, no override) → counts as user
     └─ none   → bot post (chat:write.customize) + Connect nudge (degraded)
  → update opening-message counter (bot)
```

## Error handling

- **Invalid/revoked token:** caught; degrade to the bot path + nudge; logged. Report never lost.
- **OAuth callback errors** (bad `state`, Slack returns `error`, `ok:false` from
  `oauth.v2.access`): render a friendly "Couldn't connect — try again" page; store nothing.
- **`NEXTAUTH_URL` unset on worker/api:** the Connect button/nudge is skipped (the report still
  posts). Logged once.
- **Whole broadcast stays best-effort/isolated** (6a contract): any failure logs `[broadcast]
  degraded` and never reverts the `completed` report.

## Security

- User tokens stored **encrypted at rest** (AES-256-GCM, key from `INTERNAL_API_SECRET`); the
  plaintext exists only transiently in the api when posting and in the web on callback.
- The worker uses `hasUserToken` (existence) and never decrypts — least privilege.
- OAuth `state` is HMAC-signed (`INTERNAL_API_SECRET`) + freshness-checked to prevent CSRF/forged
  callbacks.
- `INTERNAL_API_SECRET` must be set on **web** and **api** (and is already the worker↔api shared
  secret). Document in env/runbook.

## Operational requirements (runbook)

- **Slack app:** add the **`chat:write` user scope** (under `user_scope`) and register the
  redirect URL `${web}/api/slack/oauth/callback`. Reinstall.
- **User must be in the channel:** a user token can only post to channels the **user** belongs to
  (not just the bot). Normally true for team members; surface in the runbook.

## Testing

- **Unit (pure):** `crypto.ts` roundtrip / wrong-key / tamper.
- **Integration:** token store (`saveUserToken`/`getUserToken`/`hasUserToken`) against real PG;
  the OAuth callback route as its own test (state verify + token exchange via the stub + token
  persisted) — this is where the full install→callback flow is exercised; the api
  `broadcastReport` user-token vs degraded branches with a fake/stub slack.
- **smoke:standup:** the two end-to-end paths above — the connected path seeds a token via
  `saveUserToken` (not the web route) and asserts the user-token post; the unconnected path
  asserts the degraded bot post + nudge.

## Definition of done (per phase)

1. `smoke:standup` (user-token + degraded paths) green in CI, plus unit/integration.
2. **Live runbook walked:** connect a real user, complete a standup, confirm the channel report
   has **no "APP" badge** (true user post); confirm an unconnected member still posts degraded
   with the Connect nudge.
3. Root `README.md` — **tick** "Channel broadcast posted **as the user**, threaded under a daily
   opening message" (6b completes it); add the `chat:write` user scope + `INTERNAL_API_SECRET` on
   web/api + the user-must-be-in-channel note.
4. `ContextDB/` docs updated (slack-integration reporter-OAuth status, getting-started connect
   step, build log) + the post-as-user ADR marked implemented.

## Files (anticipated)

```
packages/shared/src/crypto.ts (+ test)            # encryptToken / decryptToken
packages/shared/src/index.ts                       # re-export
packages/db/src/tokens.ts (+ test)                 # saveUserToken / getUserToken / hasUserToken
packages/db/src/index.ts                           # re-export
apps/web/app/api/slack/install/route.ts            # redirect to Slack authorize
apps/web/app/api/slack/oauth/callback/route.ts (+ test)  # exchange + store + success page
apps/web/lib/oauth-state.ts (+ test)               # sign/verify HMAC state
apps/worker/src/sendDm.ts (+ test)                 # Connect button when !hasUserToken
apps/api/src/handleMessage.ts (+ test)             # broadcast as user / degraded + nudge
tools/slack-stub/src/server.ts (+ test)            # oauth/v2/authorize + oauth.v2.access + token recording
apps/api/tests/standup-smoke.test.ts               # connected + unconnected assertions
README.md · ContextDB/* · ADR · build log          # DoD
```
