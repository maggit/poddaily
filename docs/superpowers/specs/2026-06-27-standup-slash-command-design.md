# `/standup` Slash Command — Design Spec

> Validated design for the `/standup` Slack slash command. Derived from the Phase 4 / P1
> backlog (`/standup` slash command) and the brainstorming session on 2026-06-27.

## 1. Problem & scope

Members can start a standup on demand today only by DMing the bot a keyword
(`redo`/`restart`/`start`/`standup`) — undiscoverable and only works from inside the bot DM. This
adds a discoverable `/standup` slash command, invokable from any channel, with two subcommands:

- **`/standup start`** (and bare `/standup`) — start/restart my standup now.
- **`/standup status`** — show whether I've reported today.

**In scope:** the slash-command front door over the *existing* retrigger machinery; an ephemeral
status read; manifest registration; tests.

**Out of scope:** admin/team-wide triggering, multi-team selection (Phase 1 is one team per user),
amending an already-submitted report, any change to the DM Q&A engine or the worker `retrigger()`.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Subcommands | `start` (and bare `/standup`) + `status`; unknown text → usage hint |
| Already-completed start | **Block** with a nudge — no re-DM, no re-broadcast (consistent with the DM keyword) |
| Status detail | **Three-state**: completed / in-progress (N of M) / not-reported-yet |
| On-demand timing | Start **bypasses the schedule** (opens a run any day/time) — reuses retrigger's `ensureRunOpen` + team recovery |
| Response visibility | All replies **ephemeral** (only the invoker sees them) |
| RBAC | None — only ever acts on the invoker's own standup |
| Command shape | Single registered `/standup`; subcommand parsed from Slack's `text` arg |

## 3. Behavior

All replies are ephemeral. The handler does fast DB reads inline and **defers the DM work to the
existing retrigger worker job**, so it acks well within Slack's 3s window.

### 3.1 Member-day state (shared classification)

A single helper resolves the invoker's state for today, used by both subcommands and by the DM
keyword path:

```
getMemberDayState(db, slackUserId) -> {
  member?: { teamId, slackDisplayName },
  standup?: Standup,
  state: "not_member" | "completed" | "in_progress" | "pending",
  answered: number,   // answers recorded so far (in_progress only)
  total: number,      // standup.questions.length
}
```

- `not_member` — no `team_members` row for this `slackUserId`.
- `completed` — today's run exists and the member's report `status === "completed"`.
- `in_progress` — today's run exists and the member's report `status === "in_progress"`.
- `pending` — anything else (no run opened yet, no report, or `timed_out`).

"Today" is `anchorDate(standup.scheduleTz, now)`, matching `maybeRetrigger`.

### 3.2 `/standup start` (and bare `/standup`)

| State | Action | Ephemeral reply |
|---|---|---|
| `not_member` | none | "You're not set up for standups yet — ask an admin to add you to a team." |
| `completed` | none (block) | "You've already reported today ✅ — run `/standup status` to review." |
| `in_progress` | none | "You've got a standup in progress — check your DMs to finish. ⏳" |
| `pending` | enqueue the retrigger job for this member's standup | "📋 Starting your standup — check your DMs." |

The enqueued job is the **same** one the DM keyword enqueues; the worker `retrigger()` opens the
run if needed (whole-team recovery), re-sends intro + Q1, and the existing `handleMessage` flow
drives the rest.

**`channel` field note:** a slash payload has no DM channel (only `command.channel_id`, the channel
the command was typed in), but the worker `retrigger()` resolves the DM itself via
`slack.openDm(slackUserId)` and does not need a DM channel from the caller. The plan must confirm
the `RetriggerJob` type: if `channel` is required, pass `command.channel_id` (unused for the DM); if
optional, omit it. No behavior depends on this value for the start path.

### 3.3 `/standup status`

| State | Ephemeral reply |
|---|---|
| `not_member` | "You're not set up for standups yet — ask an admin to add you to a team." |
| `completed` | "✅ You reported today." |
| `in_progress` | "⏳ In progress — {answered} of {total} answered. Check your DMs to finish." |
| `pending` | "You haven't reported today yet — run `/standup` to start." |

### 3.4 Unknown subcommand

`/standup <anything other than start/status/empty>` → "Try `/standup` to start, or `/standup status`."

Parsing: `text.trim().toLowerCase()`; `"" | "start"` → start; `"status"` → status; else → usage.

## 4. Architecture

- **New `apps/api/src/handleCommand.ts`** — `handleCommand(deps, { slackUserId, text }): Promise<string>`
  returns the ephemeral reply text. Resolves state via `getMemberDayState`, parses the subcommand,
  decides enqueue-vs-message. Dependency-injection shape mirrors `handleMessage`
  (`{ db, enqueueRetrigger }`). Pure formatting/parsing split into small testable functions
  (`parseSubcommand`, `formatStatus`, `formatStartResult`).
- **`getMemberDayState`** — new shared query helper (in `apps/api/src/`, e.g. `standupState.ts`),
  consumed by both `handleCommand` and `maybeRetrigger` (see §6 cleanup).
- **Wire in `apps/api/src/index.ts`**:

  ```ts
  app.command("/standup", async ({ ack, command }) => {
    const reply = await handleCommand({ db, enqueueRetrigger }, {
      slackUserId: command.user_id,
      text: command.text,
    });
    await ack(reply); // ack with text → ephemeral response
  });
  ```

  Bolt routes commands and `message.im` events through the same `/slack/events` endpoint;
  signing-secret verification is already configured on the `App`.

**Data flow:** Slack → `POST /slack/events` (Bolt) → `app.command("/standup")` → `handleCommand`
(reads DB; for `pending` start, enqueues a retrigger job) → ephemeral `ack(reply)` → [worker
`retrigger()` opens run + DMs Q1] → existing `handleMessage` drives the Q&A.

## 5. What is reused vs new

**Reused unchanged:** `enqueueRetrigger` + worker `retrigger()`; the DM Q&A engine; the broadcast
flow; the `standup_runs` / `standup_reports` schema.

**New:** `handleCommand.ts`, `standupState.ts` (`getMemberDayState`), the `app.command` wiring, the
manifest `slash_commands` entry, tests.

## 6. Targeted cleanup (DRY)

`maybeRetrigger` (the DM keyword path in `handleMessage.ts`) currently inlines "find the member +
today's run/report state." Refactor it to use the new `getMemberDayState` so the slash command and
the DM keyword classify identically and can't drift. This is in-scope because both front doors must
agree; no behavior change to the DM keyword.

## 7. Manifest & deployment

- Add to [`app_manifest.yaml`](../../app_manifest.yaml):

  ```yaml
  settings:
    slash_commands:
      - command: /standup
        url: https://poddaily.example.com/api/slack/events   # same endpoint as message events
        description: Start your standup, or check your status
        usage_hint: "[status]"
        should_escape: false
  ```

- The `commands` bot scope is **already declared**, so no new scopes and no reinstall for scope
  reasons. Registering the command does require **updating the Slack app from the manifest** (Slack
  app config) so `/standup` appears and routes to the request URL — a deploy step documented in the
  Dokploy runbook + Slack app section.

## 8. Testing & Definition of Done

**Tests** (mirror `apps/api/src/handleMessage.test.ts` — `fakeSlack`, injected deps, direct DB):

- Pure unit: `parseSubcommand` (empty/start/status/unknown, case + whitespace); `formatStatus` and
  `formatStartResult` for every state.
- `handleCommand` with injected `db` + fake `enqueueRetrigger`:
  - `not_member` → not-set-up reply, **no** enqueue.
  - `completed` → block nudge, **no** enqueue.
  - `in_progress` → check-DMs reply (status shows N of M), **no** enqueue.
  - `pending` → "starting" reply **and** one `enqueueRetrigger` with the right `standupId`/user.
  - `status` variants → correct text per state.
  - unknown subcommand → usage hint.
- Smoke: a `/standup` happy path (member with no report today → enqueues retrigger) added to an
  api smoke test + script.

**Definition of done** (per [CLAUDE.md](../../CLAUDE.md)):
1. New smoke green in CI (unit + integration via `pnpm test`).
2. Live smoke: run `/standup` and `/standup status` in a real Slack dev workspace; confirm the DM
   arrives and the ephemeral replies are correct.
3. **README updated** — tick the `/standup` item in the feature checklist; document the command +
   subcommands for self-hosters, and the manifest-update deploy step.
4. ContextDB updated — build log under `08_logs/`; note the slash-command registration step in the
   Dokploy runbook / Slack app section.
