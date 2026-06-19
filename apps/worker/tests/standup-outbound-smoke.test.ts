import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { enqueueOpenRun } from "../src/queue";
import { createProcessor } from "../src/processor";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "standup-smoke"; // isolated queue name for the test
const { db, sql } = createDb();
const CHAN = "C_SMOKE_OUTBOUND";
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
  await sql`delete from standup_reports where slack_user_id = 'U_SMOKE_OUT'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = 'U_SMOKE_OUT'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("smoke:standup-outbound", () => {
  it("trigger → run opens → member receives intro + Q1 via BullMQ", async () => {
    // clean + seed (delete runs before teams — standup_runs.standup_id is ON DELETE
    // no action, so orphan runs from an unclean prior exit would block the cascade)
    await sql`delete from standup_reports where slack_user_id = 'U_SMOKE_OUT'`;
    await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
    await sql`delete from team_members where slack_user_id = 'U_SMOKE_OUT'`;
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Smoke Out Pod', ${CHAN}, 'smoke-out') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, 'U_SMOKE_OUT', 'Smoke Out', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])},
              ${CRON}, 'UTC', 'Morning!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await enqueueOpenRun(queue, s.id);

    const log = await waitFor(
      async () => (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ channel: string; text: string }>,
      (l) => l.length >= 2,
    );
    expect(log[0].text).toBe("Morning!");
    expect(log[1].text).toBe("What did you do?");

    const reports = await sql`select * from standup_reports where slack_user_id = 'U_SMOKE_OUT' and status = 'in_progress'`;
    expect(reports).toHaveLength(1);
  });
});
