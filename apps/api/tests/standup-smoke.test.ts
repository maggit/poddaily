import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { enqueueOpenRun } from "../../worker/src/queue";
import { createProcessor } from "../../worker/src/processor";
import { handleMessage } from "../src/handleMessage";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "standup-smoke-5b"; // isolated queue name — must not collide with the outbound smoke
const { db, sql } = createDb();
const CHAN = "C_SMOKE_STANDUP";
const USER = "U_SMOKE_STANDUP";
const DM = "D_SMOKE_STANDUP";
const CRON = cronFromWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 0, minute: 0 }); // every day, 00:00 → immediate send

let stub: SlackStub;
let queue: Queue;
let worker: Worker;

beforeAll(async () => {
  stub = await startSlackStub(0);
  process.env.SLACK_API_BASE_URL = stub.url;
  process.env.SLACK_BOT_TOKEN = "xoxb-smoke";

  queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  await queue.obliterate({ force: true }); // clean slate
  const slack = createSlackClient();
  worker = new Worker(QUEUE_NAME, createProcessor({ db, slack, queue }), { connection: { url: REDIS_URL } });
  await worker.waitUntilReady(); // ensure the subscription is live before jobs are enqueued
});

afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await stub.close();
  await cleanup();
  await sql.end();
});

// delete reports → runs → members → teams to avoid FK cascade issues (standup_runs.standup_id
// is ON DELETE no action, so orphan runs from an unclean prior exit would block the cascade)
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("smoke:standup", () => {
  it("outbound DM → member answers all questions → completed + outro", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Standup Pod', ${CHAN}, 'standup') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'Standup Tester', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, outro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${JSON.stringify([
                { id: "q1", text: "What did you do?", type: "text" },
                { id: "q2", text: "What will you do?", type: "text" },
              ])},
              ${CRON}, 'UTC', 'Morning!', 'See you tomorrow!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });

    // OUTBOUND (Step 5a): the worker opens the run and DMs intro + Q1.
    await enqueueOpenRun(queue, s.id);
    await waitFor(
      async () => (await (await fetch(`${stub.url}/__stub/messages`)).json()) as unknown[],
      (l) => l.length >= 2,
    );
    const inProgress = await sql`select * from standup_reports where slack_user_id = ${USER} and status = 'in_progress'`;
    expect(inProgress).toHaveLength(1);

    // INBOUND (Step 5b): the member answers each question. handleMessage persists the
    // answer, posts the next question, then completes the report + posts the outro.
    const slack = createSlackClient();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Shipped the scheduler" });
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Build the inbound engine" });

    const [report] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(report.status).toBe("completed");
    expect(report.answers).toHaveLength(2);
    expect(report.answers[1].answer).toBe("Build the inbound engine");

    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ text: string }>;
    const texts = msgs.map((m) => m.text);
    expect(texts).toContain("What will you do?");
    expect(texts).toContain("See you tomorrow!");

    // --- broadcast assertions (6a) ---
    const allMsgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{
      channel: string; text: string; thread_ts?: string; username?: string;
    }>;
    const channelMsgs = allMsgs.filter((m) => m.channel === CHAN);

    // opening message posted to the team channel by the worker
    expect(channelMsgs.some((m) => m.text.includes("Reported: 0 out of 1"))).toBe(true);

    // threaded report reply, attributed to the member
    const reply = channelMsgs.find((m) => m.thread_ts && m.username === "Standup Tester");
    expect(reply).toBeTruthy();
    expect(reply!.text).toContain("Build the inbound engine");

    // channel_post_ts persisted on the report
    const [reportRow] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(reportRow.channel_post_ts).not.toBeNull();

    // opening counter updated to 1 of 1
    const updates = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<{ text: string }>;
    expect(updates.some((u) => u.text.includes("Reported: 1 out of 1"))).toBe(true);
  });
});
