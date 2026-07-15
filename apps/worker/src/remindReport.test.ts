import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { remindReport } from "./remindReport";

const { db, sql } = createDb();
const CHAN = "C_REMIND";
const USER = "U_REMIND";

function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return { posts, openDm: async () => "D_R", postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts"; }, updateMessage: async () => {}, getPermalink: async () => null, getUserProfile: async () => ({ image: null, tz: null, realName: null }), listAllUsers: async () => [] };
}
async function cleanup() {
  await sql`delete from standup_reminders where slack_user_id = ${USER}`;
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });
async function seed(status: "in_progress" | "completed" | "timed_out"): Promise<string> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Remind Pod', ${CHAN}, 'rem') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 9 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'Remind Tester', ${JSON.stringify([])}, ${status})`;
  return run.id;
}

describe("remindReport", () => {
  it("nudges and records a reminder when the report is in_progress", async () => {
    const runId = await seed("in_progress");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain("Daily Standup");
    const rows = await sql`select * from standup_reminders where slack_user_id = ${USER}`;
    expect(rows).toHaveLength(1);
  });
  it("no-ops when the report is completed", async () => {
    const runId = await seed("completed");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(0);
    const rows = await sql`select * from standup_reminders where slack_user_id = ${USER}`;
    expect(rows).toHaveLength(0);
  });
  it("no-ops when the report is timed_out", async () => {
    const runId = await seed("timed_out");
    const slack = fakeSlack();
    await remindReport({ db, slack }, { runId, slackUserId: USER });
    expect(slack.posts).toHaveLength(0);
  });
});
