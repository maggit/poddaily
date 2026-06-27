# 2026-06-27 — `/standup` slash command

Members could already restart a missed standup by DMing the bot a keyword (`redo`/`restart`/`start`/`standup`), but the feature was undiscoverable and only worked from inside the bot DM. This ships a proper `/standup` Slack slash command, invokable from any channel. Spec:
[2026-06-27-standup-slash-command-design.md](../../docs/superpowers/specs/2026-06-27-standup-slash-command-design.md).
Plan: [2026-06-27-standup-slash-command.md](../../docs/superpowers/plans/2026-06-27-standup-slash-command.md).

## What shipped

Three subcommands, all replying ephemerally (only the invoker sees the reply):

- **`/standup`** or **`/standup start`** — start/restart your standup now, on demand, any day/time, bypassing the schedule. Blocks with a nudge if already reported today; says "check your DMs" if one is already in progress.
- **`/standup status`** — three-state: reported today ✅ / in progress (N of M answered, check DMs) / not reported yet.
- **`/standup help`** (and any unknown input) — lists the available commands. Unknown subcommands route here so the command is self-documenting.

The Q&A itself continues in the bot DM, driven by the existing `handleMessage` engine.

## The shared `getMemberDayState` classifier

A new `apps/api/src/standupState.ts` resolves any member's state for today in one place:

```ts
getMemberDayState(db, slackUserId) -> {
  member?, standup?, state, answered, total
}
// state: "not_member" | "completed" | "in_progress" | "pending"
```

Both the slash command handler and the DM keyword path (`maybeRetrigger` in `handleMessage.ts`)
use it — they can't drift. Previously `maybeRetrigger` inlined this logic; the refactor is a
no-behavior-change DRY pass.

## `maybeRetrigger` refactor

`handleMessage.ts`'s `maybeRetrigger` function now calls `getMemberDayState` instead of
duplicating the member/run/report lookup. State mapping is identical to before; `in_progress`
now triggers the "already in progress" DM reply (previously sent to the channel) — a minor
UX alignment, no logic change.

## New files

- `apps/api/src/standupState.ts` — `getMemberDayState` shared query helper.
- `apps/api/src/handleCommand.ts` — `handleCommand(deps, { slackUserId, text })` → ephemeral reply string. Subcommand parsing (`parseSubcommand`), formatting helpers (`formatStatus`, `formatStartResult`, `formatHelp`).

## Manifest change

`app_manifest.yaml` gained a `slash_commands` entry:

```yaml
settings:
  slash_commands:
    - command: /standup
      url: https://poddaily.example.com/api/slack/events
      description: Start your standup, or check your status
      usage_hint: "[status|help]"
      should_escape: false
```

The `commands` bot scope was already declared — no new scopes, no reinstall.

## Wiring

`apps/api/src/index.ts` registers the command with Bolt:

```ts
app.command("/standup", async ({ ack, command }) => {
  const reply = await handleCommand({ db, enqueueRetrigger }, {
    slackUserId: command.user_id,
    text: command.text,
  });
  await ack(reply);   // ack with text → ephemeral reply
});
```

Bolt routes both slash commands and `message.im` events through `/slack/events` — no new endpoint.

## Verification

- `pnpm test` — **182 passed / 182** (43 files), 0 failures.
- New test files: `standupState.test.ts` (6 tests — classifier for all four states including in-progress answer count), `handleCommand.test.ts` (10 tests — parse/classify/enqueue for all subcommand/state combinations), `standup-command-smoke.test.ts` (1 smoke test — pending member → enqueues retrigger).
- `pnpm run check` (web lint + typecheck) passed.

## Definition of done

1. Automated `pnpm test` green — 182/182 ✅.
2. README updated — `/standup` ticked shipped, usage subsection + manifest deploy step added ✅.
3. Deployment runbook (`deployment-dokploy.md`) updated — slash command registration note in Part D ✅.
4. This build log ✅.
5. **Live smoke** (manual — requires a Slack dev workspace): pending. Walk: `/standup help` → command list; `/standup status` → "haven't reported today"; `/standup` → DM arrives, answer it; `/standup` again → "already reported"; `/standup status` → "reported today". Record the walk here when done.
