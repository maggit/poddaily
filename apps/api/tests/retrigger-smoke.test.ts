import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { createProcessor } from "../../worker/src/processor";
import { handleMessage } from "../src/handleMessage";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "retrigger-smoke";
const { db, sql } = createDb();
const CHAN = "C_SMOKE_RETRIG";
const USER = "U_SMOKE_RETRIG";
const DM = "D_RETRIG";
const SECRET = "test-internal-api-secret-0123456789";
const makeUserSlack = (token: string) => createSlackClient({ token });

let stub: SlackStub;
let queue: Queue;
let worker: Worker;
// In production the api creates this; here we wire it to the smoke's queue.
const enqueueRetrigger = (job: any) => queue.add("retrigger", job).then(() => undefined);

beforeAll(async () => {
  process.env.STANDUP_TIMEOUT_MS = "60000"; // long — the member answers well before the fresh timeout fires
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
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
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

describe("smoke:retrigger", () => {
  it("re-opens a timed-out standup via the 'redo' keyword and lets the member complete it", async () => {
    await cleanup();
    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Retrig Pod', ${CHAN}, 'retrig') returning id`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'Retrig Tester', 'UTC', true)`;
    const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
      values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }, { id: "q2", text: "Today?", type: "text" }])}, '0 0 * * *', 'UTC', 'Morning!', true) returning id`;
    // a timed-out run + report for today (simulating the missed/swept standup)
    const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, channel_opening_ts) values (${s.id}, now(), current_date, 'completed', 'open_rt') returning id`;
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, reported_at) values (${run.id}, ${USER}, 'Retrig Tester', ${JSON.stringify([])}, 'timed_out', now())`;

    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });

    // member DMs "redo" → api enqueues a retrigger job
    const slack = createSlackClient();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "redo" });

    // worker re-opens: report flips back to in_progress, run back to running
    await waitFor(
      async () => (await sql`select status from standup_reports where slack_user_id = ${USER}`),
      (rows) => rows[0]?.status === "in_progress",
    );
    const [runRow] = await sql`select status from standup_runs where id = ${run.id}`;
    expect(runRow.status).toBe("running");

    // member answers both questions → completes + broadcasts (degraded bot post; no user token)
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "did it now" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack, enqueueRetrigger }, { slackUserId: USER, channel: DM, text: "more today" });

    const [final] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(final.status).toBe("completed");
    expect(final.channel_post_ts).not.toBeNull(); // broadcast happened on completion
  });
});
