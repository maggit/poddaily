# 2026-06-20 — Step 6a Build: Channel Broadcast

Executed the [Step 6a plan](../../docs/superpowers/plans/2026-06-20-step6a-channel-broadcast.md)
(spec: [design doc](../../docs/superpowers/specs/2026-06-20-step6a-channel-broadcast-design.md))
on branch `feat/step6a-channel-broadcast`. When a member completes their standup DM, their
report is now broadcast to the team's Slack channel — threaded under a daily opening message,
attributed to the member via name/avatar (`chat:write.customize`).

## What shipped

- **Schema — `standup_runs.channel_opening_ts`.** A new column holding the `ts` of the run's
  opening thread message, so per-report replies thread under it. Added with a migration.
- **`packages/shared` — pure Block Kit builders.** `buildOpeningMessage` (the
  `📋 Daily Standup … Reported: n out of total` opening text) and `buildReportBlocks` (the
  per-report Block Kit reply) — pure functions, no DB / no Slack, unit-tested.
- **`@poddaily/slack-client` extension.** `postMessage` gained thread / customize / blocks
  options (`thread_ts`, `username`/`icon_url` for `chat:write.customize`, `blocks`), and a new
  `updateMessage` wrapper for `chat.update` (the counter update).
- **Worker — `openRun` opening post.** At run-open the worker posts the opening message to the
  team channel and persists its `ts` to `standup_runs.channel_opening_ts` (eager, race-free).
- **api — `handleMessage` threaded broadcast + counter.** On report completion the api posts the
  report as a threaded reply under the opening message (via `chat:write.customize`) and updates
  the `Reported: n out of total` counter via `chat.update`. Best-effort and isolated: a
  channel-post failure logs `[broadcast] degraded` and is swallowed — the completed report is
  never reverted.
- **slack-stub extension.** Records `thread_ts` / `username` / `blocks` on `chat.postMessage`
  and handles `chat.update`, so smoke can assert the threaded reply, attribution, and counter.
- **`smoke:standup` broadcast assertions.** The full outbound→inbound smoke now also asserts the
  opening message, the threaded reply, the persisted `channel_post_ts`, and the counter.

## Verification

- `pnpm test`: **21 files / 82 tests passing** (unit + integration, including the
  `smoke:standup-outbound` suite that runs as part of the default `vitest` run).
- `pnpm smoke:standup`: green — opening message posted, completed report posted as a threaded
  reply, `standup_reports.channel_post_ts` persisted, counter reads `1 out of 1`.

## Notable decisions / scope

- **Approach A — eager opening post by the worker at run-open.** The worker posts the opening
  message (and stores its `ts`) when it opens the run, before any DM completes — race-free, since
  the thread anchor exists before the first reply. The api only posts replies and updates the
  counter.
- **Counter derived from `standup_reports`.** `total` = number of report rows for the run,
  `reported` = the completed ones; the counter is recomputed from the DB on each update rather
  than incremented in place.
- **Best-effort isolation.** A broadcast failure logs `[broadcast] degraded` and is swallowed;
  the completed report (DM outro included) is never reverted by a channel-post error.
- **`chat:write.customize` attribution — the 6a→6b boundary.** 6a attributes via the member's
  name/avatar (bot posts as itself with `username`/`icon_url`). True user-token authorship
  (post-as-user) is **Step 6b**; the 6a name/avatar path is the permanent fallback for members
  without a user token.
- **`date` = `run.scheduledDate` on both sides.** The opening heading uses the run's scheduled
  date in both the worker's initial post and the api's `chat.update`, so the heading stays
  byte-identical across post + update.
- **Bot-must-be-in-channel operational requirement.** `chat.postMessage` returns
  `not_in_channel` unless the bot is invited to each team's channel (`/invite @poddaily`); that
  case is logged as degraded.
- **Outbound smoke positional assertions.** The `smoke:standup-outbound` stub-log assertions were
  positional and had to be updated to filter by channel, since the worker now posts the opening
  message in addition to the DMs.

## Definition of done — honest status

- Automated `smoke:standup` (+ unit + integration) green in CI — ✓ (21 files / 82 tests).
- Root `README.md` + `ContextDB/` updated (README checklist sub-bullet + worker/api prose,
  slack-integration status note, getting-started 6a note, this log) — ✓.
- **Live smoke runbook against a real Slack dev workspace — NOT yet walked.** The end-to-end
  channel broadcast (including the **bot-invite-to-channel** step, `/invite @poddaily`) has not
  been validated against a real Slack workspace — that remains a pending human-operator step.
- The README **"Channel broadcast posted as the user"** checklist item stays **unticked** — true
  post-as-user authorship is Step 6b. 6a only adds the indented sub-bullet noting the threaded
  name/avatar broadcast.

So Step 6a is **CI-green and documented, but NOT yet live-verified**. The per-phase Definition of
Done is not complete until the live runbook (with the bot invited to a real team channel) is
walked by a human operator.

## Out of scope (not done in 6a)

- True post-as-user / user-OAuth authorship → **Step 6b**.
- 4h timeout sweeper → **Step 7**.

Next: Step 6b — true post-as-user broadcast via the reporter user token.
