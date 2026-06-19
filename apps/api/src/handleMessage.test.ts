import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleMessage } from "./handleMessage";

const { db, sql } = createDb();
const CHAN = "C_HM_TEST";
const USER = "U_HM_TEST";
const DM = "D_HM_TEST";

/** In-memory SlackClient that records posts; openDm is unused on the inbound path. */
function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    async openDm() { return DM; },
    async postMessage(channel: string, text: string) { posts.push({ channel, text }); return "ts1"; },
  };
}

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
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "Did stuff" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(1);
    expect(r.status).toBe("in_progress");
    expect(slack.posts.at(-1)?.text).toBe("What will you do?");
  });

  it("completes after the last question and posts the outro", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 1" });
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "answer 2" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.answers).toHaveLength(2);
    expect(r.status).toBe("completed");
    expect(slack.posts.at(-1)?.text).toBe("Thanks!");
  });

  it("`skip all` aborts the report to timed_out", async () => {
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "skip all" });
    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    expect(r.answers).toHaveLength(0);
    expect(slack.posts.at(-1)?.text).toBe("No problem — skipping today's standup. 👋");
  });

  it("ignores a DM when the user has no open report", async () => {
    await sql`delete from standup_reports where slack_user_id = ${USER}`;
    const slack = fakeSlack();
    await handleMessage({ db, slack }, { slackUserId: USER, channel: DM, text: "hello?" });
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
    await handleMessage({ db, slack }, { slackUserId: USER2, channel: "D_HM_NOOUTRO", text: "the only answer" });

    const [r] = await sql`select * from standup_reports where slack_user_id = ${USER2}`;
    expect(r.status).toBe("completed");
    expect(slack.posts.at(-1)?.text).toBe("Thanks — your standup is in. ✅");

    // cleanup this test's isolated fixtures
    await sql`delete from standup_reports where slack_user_id = ${USER2}`;
    await sql`delete from standup_runs where id = ${run2.id}`;
    await sql`delete from standups where id = ${s2.id}`;
    await sql`delete from teams where id = ${team2.id}`;
  });
});
