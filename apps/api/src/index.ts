import { App } from "@slack/bolt";
import { Queue } from "bullmq";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { QUEUE_NAME, type RetriggerJob } from "@poddaily/shared";
import { handleMessage } from "./handleMessage";

const { db } = createDb();
const slack = createSlackClient();
const secret = process.env.INTERNAL_API_SECRET ?? "";
const makeUserSlack = (token: string) => createSlackClient({ token });

const queue = new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
const enqueueRetrigger = (job: RetriggerJob) =>
  queue.add("retrigger", job, { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: false }).then(() => undefined);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// message.im — a user's DM reply. Ignore edits/joins/bot echoes (any subtype) and
// non-DM channels. The reducer is idempotent, so a redelivery is harmless.
app.message(async ({ message }) => {
  const m = message as { subtype?: string; channel_type?: string; user?: string; channel: string; text?: string };
  if (m.subtype !== undefined || m.channel_type !== "im" || !m.user || !m.text) return;
  await handleMessage({ db, slack, secret, makeUserSlack, enqueueRetrigger }, { slackUserId: m.user, channel: m.channel, text: m.text });
});

const port = Number(process.env.PORT ?? 3001);
await app.start(port);
console.log(`[api] bolt listening on :${port} (POST /slack/events)`);
