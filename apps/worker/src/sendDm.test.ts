import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { createDb, saveUserToken } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { sendDm } from "./sendDm";

const TOKEN_SECRET = process.env.INTERNAL_API_SECRET ?? "test-secret-aaaaaaaaaaaaaaaaaaaa";

const { db, sql } = createDb();
const CHAN = "C_SENDDM";
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => {
  await sql`delete from slack_user_tokens where slack_user_id = 'U_SEND'`;
  await stub.close();
  await sql.end();
});

function makeEnqueueTimeoutRecorder() {
  const calls: Array<{ job: { runId: string; slackUserId: string }; delayMs: number }> = [];
  const fn = async (job: { runId: string; slackUserId: string }, opts: { delayMs: number }) => { calls.push({ job, delayMs: opts.delayMs }); };
  return Object.assign(fn, { calls });
}

async function seedRun(intro: string | null) {
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SendDm Pod', ${CHAN}, 'senddm-pod') returning id`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "What have you done since {last_report_date}?", type: "text" }])},
            ${CRON}, 'UTC', ${intro}, true)
    returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  return { standupId: s.id as string, runId: run.id as string };
}

beforeEach(async () => {
  // Default to unconnected + no web URL so existing message-count assertions hold
  // (the Connect nudge is skipped when NEXTAUTH_URL is unset). Tests that exercise
  // the nudge opt in by setting NEXTAUTH_URL explicitly.
  delete process.env.NEXTAUTH_URL;
  await sql`delete from slack_user_tokens where slack_user_id = 'U_SEND'`;
  await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
  await sql`delete from standup_reports where slack_user_id = 'U_SEND'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
});

describe("sendDm", () => {
  it("opens a DM, posts intro + interpolated Q1, inserts an in_progress report", async () => {
    const { standupId, runId } = await seedRun("Good morning! :wave:");
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });

    await sendDm({ db, slack, enqueueTimeout: makeEnqueueTimeoutRecorder() }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(2); // intro + Q1
    expect(log[0].text).toBe("Good morning! :wave:");
    expect(log[1].text).toContain("What have you done since");
    expect(log[1].text).toContain("your last report"); // no prior report → fallback

    const reports = await sql`select * from standup_reports where run_id = ${runId} and slack_user_id = 'U_SEND'`;
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("in_progress");
    expect(reports[0].answers).toEqual([]);
    expect(reports[0].dm_thread_ts).toBeTruthy();
  });

  it("skips the intro post when introMessage is null (Q1 only)", async () => {
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    await sendDm({ db, slack, enqueueTimeout: makeEnqueueTimeoutRecorder() }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(1);
    expect(log[0].text).toContain("What have you done since");
  });

  it("is safe to retry — a second call does not double-insert the report or repost", async () => {
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const job = { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" };
    const enqueueTimeout = makeEnqueueTimeoutRecorder();
    await sendDm({ db, slack, enqueueTimeout }, job);
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await sendDm({ db, slack, enqueueTimeout }, job);

    const reports = await sql`select count(*)::int as n from standup_reports where run_id = ${runId} and slack_user_id = 'U_SEND'`;
    expect(reports[0].n).toBe(1);
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(0); // second call short-circuited before posting
    expect(enqueueTimeout.calls).toHaveLength(1); // only the first (real send) enqueued a timeout
  });

  it("posts a Connect button to a member with no user token", async () => {
    process.env.NEXTAUTH_URL = "https://web.example";
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });

    await sendDm({ db, slack, enqueueTimeout: makeEnqueueTimeoutRecorder() }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });

    const log: Array<{ blocks?: string }> = await (await fetch(`${stub.url}/__stub/messages`)).json();
    const connect = log.find((p) => (p.blocks ?? "").includes("/api/slack/install"));
    expect(connect).toBeTruthy();
  });

  it("does NOT post a Connect button to a connected member", async () => {
    process.env.NEXTAUTH_URL = "https://web.example";
    await saveUserToken(db, TOKEN_SECRET, { slackUserId: "U_SEND", accessToken: "xoxp-x", scopes: "chat:write" });
    const { standupId, runId } = await seedRun(null);
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });

    await sendDm({ db, slack, enqueueTimeout: makeEnqueueTimeoutRecorder() }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });

    const log: Array<{ blocks?: string }> = await (await fetch(`${stub.url}/__stub/messages`)).json();
    const connect = log.find((p) => (p.blocks ?? "").includes("/api/slack/install"));
    expect(connect).toBeFalsy();
  });

  it("enqueues a timeout-report for the member after sending", async () => {
    const { standupId, runId } = await seedRun(null);
    const enqueueTimeout = makeEnqueueTimeoutRecorder();
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    await sendDm({ db, slack, enqueueTimeout }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0].job).toEqual({ runId, slackUserId: "U_SEND" });
    expect(enqueueTimeout.calls[0].delayMs).toBeGreaterThan(0);
  });

  it("respects STANDUP_TIMEOUT_MS for the timeout delay", async () => {
    process.env.STANDUP_TIMEOUT_MS = "1234";
    const { standupId, runId } = await seedRun(null);
    const enqueueTimeout = makeEnqueueTimeoutRecorder();
    const slack = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    await sendDm({ db, slack, enqueueTimeout }, { runId, standupId, slackUserId: "U_SEND", slackDisplayName: "Send User" });
    expect(enqueueTimeout.calls[0]?.delayMs).toBe(1234);
    delete process.env.STANDUP_TIMEOUT_MS;
  });
});
