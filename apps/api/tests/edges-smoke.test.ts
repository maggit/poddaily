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
const QUEUE_NAME = "edges-smoke";
const { db, sql } = createDb();
const CHAN = "C_SMOKE_EDGES";
const USER_A = "U_EDGES_A";
const USER_B = "U_EDGES_B";
const DM = "D_EDGES";
const SECRET = "test-internal-api-secret-0123456789";
const makeUserSlack = (token: string) => createSlackClient({ token });
const enqueueRetrigger = async () => {};
const CRON = cronFromWeekly({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 0, minute: 0 });

let stub: SlackStub;
let queue: Queue;
let worker: Worker;

beforeAll(async () => {
  process.env.STANDUP_TIMEOUT_MS = "1500"; // short timeout so B times out during the test
  stub = await startSlackStub(0);
  process.env.SLACK_API_BASE_URL = stub.url;
  process.env.SLACK_BOT_TOKEN = "xoxb-smoke";
  queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  await queue.obliterate({ force: true });
  const slack = createSlackClient();
  worker = new Worker(QUEUE_NAME, createProcessor({ db, slack, queue }), { connection: { url: REDIS_URL } });
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await stub.close();
  await cleanup();
  await sql.end();
  delete process.env.STANDUP_TIMEOUT_MS;
});
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id in (${USER_A}, ${USER_B})`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id in (${USER_A}, ${USER_B})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 12000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("smoke:edges", () => {
  it("times out an unanswered member and completes the run; the answerer is broadcast", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Edges Pod', ${CHAN}, 'edges') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER_A}, 'Edge A', 'UTC', true)`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER_B}, 'Edge B', 'UTC', true)`;
    const [s] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup',
              ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])},
              ${CRON}, 'UTC', 'Morning!', true) returning id`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await enqueueOpenRun(queue, s.id);

    await waitFor(
      async () => (await sql`select count(*)::int as n from standup_reports where slack_user_id in (${USER_A}, ${USER_B}) and status = 'in_progress'`),
      (rows) => rows[0].n === 2,
    );

    const slack = createSlackClient();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER_A, channel: DM, text: "did A" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER_A, channel: DM, text: "will A" });

    await waitFor(
      async () => (await sql`select status from standup_reports where slack_user_id = ${USER_B}`),
      (rows) => rows[0]?.status === "timed_out",
    );
    const [runRow] = await sql`select status from standup_runs where standup_id = ${s.id}`;
    expect(runRow.status).toBe("completed");

    const [aRow] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER_A}`;
    expect(aRow.status).toBe("completed");
    expect(aRow.channel_post_ts).not.toBeNull();

    const [bRow] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER_B}`;
    expect(bRow.channel_post_ts).toBeNull();
  });
});
