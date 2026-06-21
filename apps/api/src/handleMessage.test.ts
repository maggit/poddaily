import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb, saveUserToken } from "@poddaily/db";
import { handleMessage } from "./handleMessage";

const { db, sql } = createDb();
const CHAN = "C_HM_TEST";
const USER = "U_HM_TEST";
const DM = "D_HM_TEST";
const SECRET = "test-internal-api-secret-0123456789";

/** In-memory SlackClient that records posts; openDm is unused on the inbound path. */
function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    async openDm() { return DM; },
    async postMessage(channel: string, text: string) { posts.push({ channel, text }); return "ts1"; },
    async updateMessage() {},
  };
}

/** Default deps extras: unconnected path uses the bot client; makeUserSlack is unused. */
const makeUserSlack = () => fakeSlack();

let runId: string;

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('HM Pod', ${CHAN}, 'hm') returning id`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, outro_message, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([
              { id: "q1", text: "What did you do?", type: "text" },
              { id: "q2", text: "What will you do?", type: "text" },
            ])},
            '0 10 * * 1', 'UTC', 'Thanks!', true) returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'open') returning id`;
  runId = run.id;
});

beforeEach(async () => {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HM Tester', ${JSON.stringify([])}, 'in_progress')`;
});

afterAll(async () => { await cleanup(); await sql.end(); });

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}

describe("handleMessage", () => {
  it("records an answer and posts the next question", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "Did stuff" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(1);
    expect(r.status).toBe("in_progress");
    expect(slack.posts.at(-1)?.text).toBe("What will you do?");
  });

  it("completes after the last question and posts the outro", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "answer 1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "answer 2" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(2);
    expect(r.status).toBe("completed");
    expect(slack.posts.at(-1)?.text).toBe("Thanks!");
  });

  it("`skip all` aborts the report to timed_out", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "skip all" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    expect(r.answers).toHaveLength(0);
    expect(slack.posts.at(-1)?.text).toBe("No problem — skipping today's standup. 👋");
  });

  it("broadcasts the completed report as a threaded reply and updates the counter", async () => {
    await sql`update standup_runs set channel_opening_ts = 'open_ts_1' where id = ${runId}`;

    const posts: Array<{ channel: string; text: string; opts: any }> = [];
    const updates: Array<{ channel: string; ts: string; text: string }> = [];
    const slack = {
      openDm: async () => "D",
      postMessage: async (channel: string, text: string, opts: any = {}) => { posts.push({ channel, text, opts }); return "post_ts_1"; },
      updateMessage: async (channel: string, ts: string, o: any) => { updates.push({ channel, ts, text: o.text }); },
    };

    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "answer 1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "answer 2" });

    const reply = posts.find((p) => p.opts?.threadTs === "open_ts_1");
    expect(reply).toBeTruthy();
    expect(reply!.opts.username).toBe("HM Tester");
    expect(reply!.channel).toBe(CHAN);

    const [r] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(r.channel_post_ts).toBe("post_ts_1");

    const upd = updates.find((u) => u.ts === "open_ts_1");
    expect(upd?.text).toContain("Reported: 1 out of 1");

    await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
  });

  it("does not throw and leaves the report completed when broadcast has no opening ts", async () => {
    await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a2" });
    const [r] = await sql`select status, channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("completed");
    expect(r.channel_post_ts).toBeNull();
  });

  it("finalizes the run when the last report completes", async () => {
    await sql`update standup_runs set channel_opening_ts = 'open_ts_fin', status = 'running' where id = ${runId}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a2" });
    const [run] = await sql`select status, completed_at from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(run.completed_at).not.toBeNull();
  });

  it("finalizes the run when the last report aborts via skip all", async () => {
    await sql`update standup_runs set status = 'running' where id = ${runId}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "skip all" });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    const [run] = await sql`select status, completed_at from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(run.completed_at).not.toBeNull();
  });

  it("ignores a DM when the user has no open report", async () => {
    await sql`delete from standup_reports where slack_user_id = ${USER}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "hello?" });
    expect(slack.posts).toHaveLength(0);
  });

  it("posts the default outro when the standup has no outro_message", async () => {
    const CHAN2 = "C_HM_NOOUTRO", USER2 = "U_HM_NOOUTRO";
    // clean first in case of a prior failed run
    await sql`delete from standup_reports where slack_user_id = ${USER2}`;
    await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN2}))`;
    await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN2})`;
    await sql`delete from teams where slack_channel_id = ${CHAN2}`;
    const [team2] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('NoOutro Pod', ${CHAN2}, 'noor') returning id`;
    const [s2] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
      values (${team2.id}, 'Daily Standup',
              ${JSON.stringify([{ id: "q1", text: "Only question?", type: "text" }])},
              '0 10 * * 1', 'UTC', true) returning id`;
    const [run2] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s2.id}, now(), current_date, 'open') returning id`;
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run2.id}, ${USER2}, 'NoOutro Tester', ${JSON.stringify([])}, 'in_progress')`;

    const slack = fakeSlack();
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER2, channel: "D_HM_NOOUTRO", text: "the only answer" });

    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER2}`;
    expect(r.status).toBe("completed");
    expect(slack.posts.at(-1)?.text).toBe("Thanks — your standup is in. ✅");

    // cleanup this test's isolated fixtures
    await sql`delete from standup_reports where slack_user_id = ${USER2}`;
    await sql`delete from standup_runs where id = ${run2.id}`;
    await sql`delete from standups where id = ${s2.id}`;
    await sql`delete from teams where id = ${team2.id}`;
  });

  it("posts the report with the member's user token when connected", async () => {
    await sql`update standup_runs set channel_opening_ts = 'open_ts_b1' where id = ${runId}`;
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-user-1", scopes: "chat:write" });

    const userPosts: Array<{ token: string; channel: string; opts: any }> = [];
    const botPosts: Array<{ channel: string; opts: any }> = [];
    const slack = {
      openDm: async () => "D",
      postMessage: async (channel: string, _t: string, opts: any = {}) => { botPosts.push({ channel, opts }); return "bot_ts"; },
      updateMessage: async () => {},
    };
    const makeUserSlackConnected = (token: string) => ({
      openDm: async () => "D",
      postMessage: async (channel: string, _t: string, opts: any = {}) => { userPosts.push({ token, channel, opts }); return "user_ts"; },
      updateMessage: async () => {},
    });

    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackConnected }, { slackUserId: USER, channel: DM, text: "a1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackConnected }, { slackUserId: USER, channel: DM, text: "a2" });

    expect(userPosts).toHaveLength(1);
    expect(userPosts[0].token).toBe("xoxp-user-1");
    expect(userPosts[0].opts.threadTs).toBe("open_ts_b1");
    expect(userPosts[0].opts.username).toBeUndefined(); // true authorship — no override
    const [r] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(r.channel_post_ts).toBe("user_ts");

    await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
    await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
  });

  it("falls back to a bot post with a Connect nudge when not connected", async () => {
    const prevNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://web.example";
    await sql`update standup_runs set channel_opening_ts = 'open_ts_b2' where id = ${runId}`;
    await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;

    const botPosts: Array<{ opts: any }> = [];
    const slack = {
      openDm: async () => "D",
      postMessage: async (_c: string, _t: string, opts: any = {}) => { botPosts.push({ opts }); return "bot_ts"; },
      updateMessage: async () => {},
    };
    const makeUserSlackThrows = () => { throw new Error("should not be called when unconnected"); };

    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackThrows }, { slackUserId: USER, channel: DM, text: "a1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackThrows }, { slackUserId: USER, channel: DM, text: "a2" });

    const reply = botPosts.find((p) => p.opts?.threadTs === "open_ts_b2");
    expect(reply).toBeTruthy();
    expect(reply!.opts.username).toBeTruthy(); // bot chat:write.customize attribution (the member name)
    expect(JSON.stringify(reply!.opts.blocks)).toContain("/api/slack/install"); // nudge present

    if (prevNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = prevNextAuthUrl;
    await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
  });

  it("falls back to a bot post when the user-token post fails (revoked)", async () => {
    const prevNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://web.example";
    await sql`update standup_runs set channel_opening_ts = 'open_ts_b3' where id = ${runId}`;
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-revoked", scopes: "chat:write" });

    const botPosts: Array<{ opts: any }> = [];
    const slack = {
      openDm: async () => "D",
      postMessage: async (_c: string, _t: string, opts: any = {}) => { botPosts.push({ opts }); return "bot_ts"; },
      updateMessage: async () => {},
    };
    // user client throws (simulating invalid_auth/token_revoked)
    const makeUserSlackRevoked = () => ({
      openDm: async () => "D",
      postMessage: async () => { throw new Error("invalid_auth"); },
      updateMessage: async () => {},
    });

    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackRevoked }, { slackUserId: USER, channel: DM, text: "a1" });
    await handleMessage({ db, slack, secret: SECRET, makeUserSlack: makeUserSlackRevoked }, { slackUserId: USER, channel: DM, text: "a2" });

    // degraded bot post happened (threaded, with the nudge), and channel_post_ts is the bot ts
    const reply = botPosts.find((p) => p.opts?.threadTs === "open_ts_b3");
    expect(reply).toBeTruthy();
    expect(reply!.opts.username).toBeTruthy(); // chat:write.customize attribution
    expect(JSON.stringify(reply!.opts.blocks)).toContain("/api/slack/install"); // nudge present
    const [r] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
    expect(r.channel_post_ts).toBe("bot_ts");

    await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
    if (prevNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = prevNextAuthUrl;
    await sql`update standup_runs set channel_opening_ts = null where id = ${runId}`;
  });
});
