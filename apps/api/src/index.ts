import { App } from "@slack/bolt";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { handleMessage } from "./handleMessage";

const { db } = createDb();
const slack = createSlackClient();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// message.im — a user's DM reply. Ignore edits/joins/bot echoes (any subtype) and
// non-DM channels. The reducer is idempotent, so a redelivery is harmless.
app.message(async ({ message }) => {
  const m = message as { subtype?: string; channel_type?: string; user?: string; channel: string; text?: string };
  if (m.subtype !== undefined || m.channel_type !== "im" || !m.user || !m.text) return;
  await handleMessage({ db, slack }, { slackUserId: m.user, channel: m.channel, text: m.text });
});

const port = Number(process.env.PORT ?? 3001);
await app.start(port);
console.log(`[api] bolt listening on :${port} (POST /slack/events)`);
