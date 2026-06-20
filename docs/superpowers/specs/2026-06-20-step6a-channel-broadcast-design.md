# Step 6a — Channel Broadcast Design

- **Date:** 2026-06-20
- **Status:** Accepted (brainstorming)
- **Phase:** 1 Core, build step 6 (first half)
- **Predecessor:** [Step 5b — inbound DM Q&A](../../../ContextDB/08_logs/2026-06-20-step5b-inbound-dm-qa.md)

## Summary

When a member finishes their standup DM (Step 5b marks the report `completed` and posts the
outro to the DM), 6a additionally **broadcasts the report to the team's Slack channel**:

- One **opening thread message** per run (`📋 Daily Standup — {date} … Reported: n out of total`),
  posted to the team channel and used as the thread parent.
- One **threaded Block Kit reply** per completed report, attributed to the member via
  `chat:write.customize` (the bot posts with the member's `username` + `icon_url`).
- The opening message's "Reported: n out of total" **counter updates** as reports complete.

6a uses `chat:write.customize` (name/avatar attribution) — the documented fallback path from the
[post-as-user ADR](../../../ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md). **Step 6b**
later adds reporter user-OAuth and swaps in true post-as-user authorship, keeping 6a's path as
the permanent fallback.

## Scope split (decided)

Build step 6 is split, mirroring 5a/5b:

- **6a (this spec):** channel broadcast, bot-posted with name/avatar attribution. Independently
  shippable + smoke-tested. No OAuth, no token store.
- **6b (later):** reporter user-OAuth — `/api/slack/install` → `/api/slack/oauth/callback`,
  AES-GCM-encrypted `slack_user_tokens`, the "Connect so I can post as you" first-DM button, and
  posting reports as the real user (falling back to 6a's `chat:write.customize`).

**Out of scope for 6a:** user-OAuth / token store / Connect button (→ 6b); the 4h timeout
sweeper (→ Step 7).

## Decisions locked

1. **Opening message posted eagerly at run-open (Approach A).** The worker, in the same
   `openRun` that opens the run and fans out DMs, posts the opening message and stores its ts on
   `standup_runs.channel_opening_ts`. Race-free: `openRun` already opens the run exactly once
   (`unique(standup_id, scheduled_date)` + `onConflictDoNothing`), so exactly one opening message
   is posted. The api posts the per-report threaded replies and updates the counter.
2. **Counter derived from `standup_reports`.** `total` = count of reports for the run (one
   in_progress row per fanned-out member), `reported` = those with `status = "completed"`. Each
   completion recomputes both from the DB and `chat.update`s the opening message — converges
   correctly even if completions overlap (last-write-wins on fresh reads).
3. **Attribution via `chat:write.customize`** (`username` + `icon_url`) for 6a. True post-as-user
   authorship is 6b.
4. **Broadcast is best-effort and isolated.** A channel-post failure logs and is swallowed; it
   never reverts the `completed` report nor fails the DM message handler (the Q&A already
   succeeded). `channel_post_ts` stays null on failure.

## Architecture & components

### 1. Schema delta

Add one nullable column to `standup_runs`:

```ts
channelOpeningTs: text("channel_opening_ts"),  // ts of the channel opening message; null until posted
```

One Drizzle migration. `standup_reports.channel_post_ts` already exists (added in 5a).

### 2. `packages/shared` — pure Block Kit builders (TDD, no Slack/DB)

- `buildOpeningMessage({ standupName, date, reported, total })` → `{ text, blocks }`:
  ```
  📋 *{standupName} — {date}*
  Find all reports for *{standupName}, {date}* in this thread.
  Reported: {reported} out of {total}
  ```
  `text` is the fallback string; `blocks` is the Block Kit section equivalent.
- `buildReportBlocks({ standupName, displayName, answers })` → `{ text, blocks }`. Per the
  [PRD message format](../../../ContextDB/01_specs/poddaily-prd.md#slack-message-format):
  a header section (`*{displayName}* posted an update for {standupName}`), a divider, then one
  section block per `{ questionText, answer }` pair (`*{questionText}*\n{answer}`). `text` is a
  plain-text fallback for notifications/accessibility.

Both pure and unit-tested. `answers` is the existing `ReportAnswer[]` from `@poddaily/shared`.

### 3. `packages/slack-client` — extend (backward-compatible)

```ts
export interface PostMessageOptions {
  threadTs?: string;   // thread_ts — reply in a thread
  username?: string;   // chat:write.customize display name
  iconUrl?: string;    // chat:write.customize avatar
  blocks?: unknown[];  // Block Kit blocks (text remains the fallback)
}

export interface SlackClient {
  openDm(slackUserId: string): Promise<string>;
  postMessage(channel: string, text: string, opts?: PostMessageOptions): Promise<string>;
  updateMessage(channel: string, ts: string, opts: { text: string; blocks?: unknown[] }): Promise<void>;
}
```

`postMessage`'s new optional `opts` keeps existing callers (`sendDm`) unchanged. `username`/
`iconUrl` map to `chat.postMessage`'s `username`/`icon_url` (requires the bot's
`chat:write.customize` scope). `updateMessage` wraps `chat.update`.

### 4. Worker — `openRun` posts the opening message

After inserting the run (and as part of the same successful open), `openRun`:
1. Looks up the team's channel: `teams.slackChannelId` via `standup.teamId`.
2. Posts the opening message (`buildOpeningMessage({ standupName: standup.name, date:
   run.scheduledDate, reported: 0, total: members.length })`) to that channel. **`date` is
   always `run.scheduledDate`** (the same value the api uses on counter updates), so the opening
   heading is byte-identical across the initial post and every `chat.update` — only the counter
   line changes.
3. Stores the returned ts in `standup_runs.channel_opening_ts` (update the run row).

`openRun`'s deps gain a `slack` client (currently it only has `db` + `enqueueSend`). The
opening post happens once per run-open; on the idempotent no-op path (run already open) nothing
is posted.

### 5. api — `handleMessage` complete branch posts the threaded reply + updates counter

In the `complete` case, after marking the report `completed` and posting the DM outro:
1. Load the run (`report.runId`) → `channelOpeningTs`; load the standup (via `run.standupId`) →
   `name` + `teamId`; load `teams.slackChannelId`; load the member's `slackAvatarUrl` from
   `team_members` (by `teamId` + `slackUserId`).
2. If `channelOpeningTs` is null → log and **skip** the channel post (report stays completed).
3. Build the report blocks and post threaded:
   `slack.postMessage(channelId, fallbackText, { threadTs: channelOpeningTs, username:
   report.slackDisplayName, iconUrl: avatar ?? undefined, blocks })` → save the returned ts to
   `standup_reports.channel_post_ts`.
4. Recompute `reported` (completed reports for run) + `total` (all reports for run) and
   `slack.updateMessage(channelId, channelOpeningTs, buildOpeningMessage({ standupName, date:
   run.scheduledDate, reported, total }))` — same `standupName` + `date` as the worker used.
5. Wrap steps 1–4 in try/catch: on any failure, `console.warn("[broadcast] degraded …")` and
   return normally. The DM handler must not throw on a broadcast failure.

### Data flow

```
worker openRun ──▶ open run ──▶ post opening message ──▶ store channel_opening_ts
                                          │
member completes Q&A (api) ──▶ mark completed + DM outro
                          └─▶ post threaded report reply (chat:write.customize)
                          └─▶ save channel_post_ts
                          └─▶ chat.update opening message counter (n of total)
```

## Error handling

- **Broadcast failure** (network, `not_in_channel`, missing opening ts): caught, logged as
  `degraded`, swallowed. Report stays `completed`; `channel_post_ts` stays null. No retry in 6a
  (a re-broadcast/repair mechanism is out of scope; revisit with Step 7's sweeper if needed).
- **Bot not in channel:** `chat.postMessage` returns `not_in_channel`. Operational requirement:
  the bot must be invited to the team channel. Surfaced as a clear `degraded` log and called out
  in the runbook. (Auto-join via `conversations.join` is deferred — would need `channels:join`.)
- **Counter races:** concurrent completions each recompute counts from the DB before
  `chat.update`, so the last update reflects the true current count. Eventual-consistent and
  correct.

## Testing

- **Unit (pure):** `buildOpeningMessage`, `buildReportBlocks` — text + block structure, including
  multi-Q&A and the counter string.
- **slack-client:** extended `postMessage` (thread_ts / username / icon_url / blocks) and
  `updateMessage`, against the stub.
- **slack-stub extension:** record `thread_ts`, `username`, `icon_url`, `blocks` on
  `chat.postMessage`; add a `chat.update` handler that records updates; expose via `__stub`.
- **`smoke:standup` (broadcast assertions):** extend the existing end-to-end smoke. After the
  member completes the Q&A, assert: (1) an opening message was posted to the team channel;
  (2) a threaded reply was posted under the opening ts with `username` = the member's display
  name and blocks containing the Q&A; (3) `standup_reports.channel_post_ts` is set; (4) the
  opening message was updated to `Reported: 1 out of 1`.

## Definition of done (per phase)

1. `smoke:standup` (with broadcast assertions) green in CI, plus the new unit tests.
2. Live runbook walked once: a real standup completes and the report appears threaded in a real
   Slack channel, attributed to the member's name/avatar.
3. Root `README.md` updated. **Note:** the checklist item "Channel broadcast posted **as the
   user**, threaded under a daily opening message" is *partially* delivered by 6a (broadcast +
   threading + name/avatar attribution). It stays **unticked** until 6b lands true post-as-user
   authorship; 6a adds a sub-note that the threaded broadcast ships now via `chat:write.customize`.
4. Affected `ContextDB/` docs updated (slack-integration broadcast status, getting-started note,
   build log) + the bot-must-be-in-channel runbook step.

## Files (anticipated)

```
packages/db/src/schema.ts + new migration   # standup_runs.channel_opening_ts
packages/shared/src/broadcast.ts (+ test)    # buildOpeningMessage, buildReportBlocks
packages/shared/src/index.ts                 # re-export
packages/slack-client/src/index.ts (+ test)  # PostMessageOptions, updateMessage
apps/worker/src/openRun.ts                   # post opening message + store ts (deps gain slack)
apps/worker/src/types.ts                     # OpenRunDeps gains slack
apps/api/src/handleMessage.ts (+ tests)      # complete branch: threaded reply + counter
tools/slack-stub/src/server.ts (+ test)      # record thread_ts/username/blocks; chat.update
apps/api/tests/standup-smoke.test.ts         # broadcast assertions
```
