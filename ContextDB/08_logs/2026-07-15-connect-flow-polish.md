# 2026-07-15 — Connect-flow polish (nudges, permalinks, post-connect cleanup)

Shipped in `feat/connect-flow-polish`:

- **Binding verified + locked by test.** The "Connect to post as yourself" link is
  identity-free (state = signed timestamp only); the token is saved under Slack's
  `authed_user.id` — whoever actually authorized on the consent screen. Clicking a link
  from another member's report footer cannot cross-bind (regression test in
  `apps/web/app/api/slack/oauth/callback/route.test.ts`).
- **Outro connect nudge.** After the outro, when the just-broadcast report went out as
  the bot (member unconnected), the DM gets one connect-button nudge — start + end of
  the conversation, never mid-flow. Nudge blocks unified in
  `@poddaily/shared` `buildConnectNudgeMessage` (used by `sendDm` + `handleMessage`).
- **`standup_reports.posted_as` ("user" | "bot") + `channel_permalink`** (migration
  0010): recorded at broadcast via new `SlackClient.getPermalink` (`chat.getPermalink`;
  stubbed in slack-stub). Reports page shows "posted as themselves / by the bot" and a
  "View in Slack" link per completed card.
- **Post-connect cleanup.** The OAuth callback best-effort edits the member's most
  recent bot-posted report: rebuilds the body from stored answers (deterministic —
  windows anchored to the report's own timestamps) and swaps the "hasn't connected"
  footer for "✅ {name} connected — future standups post as them"
  (`apps/web/lib/connect-cleanup.ts`). No delete/repost: Slack can't change a message's
  author, and reposting would lose position/reactions and re-notify.
