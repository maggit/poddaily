import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { retrigger } from "./retrigger";

const { db, sql } = createDb();
const CHAN = "C_RETRIG_TEST";
const USER = "U_RETRIG";

function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    openDm: async () => "D_RT",
    postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts_rt"; },
    updateMessage: async () => {},
    getUserProfile: async () => ({ image: null, tz: null, realName: null }),
  };
}
function fakeEnqueueTimeout() {
  const calls: Array<{ runId: string; slackUserId: string }> = [];
  const fn = async (job: { runId: string; slackUserId: string }) => { calls.push(job); };
  return Object.assign(fn, { calls });
}

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function seed(opts: { run?: "completed-run" | "no-run"; report?: "timed_out" | "none" }): Promise<{ standupId: string; runId?: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('RT Pod', ${CHAN}, 'rt') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'RT Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, intro_message, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])}, '0 10 * * 1', 'UTC', 'Morning!', true) returning id`;
  if (opts.run === "no-run") return { standupId: s.id };
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, channel_opening_ts) values (${s.id}, now(), current_date, 'completed', 'open_rt') returning id`;
  if (opts.report === "timed_out") {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, reported_at) values (${run.id}, ${USER}, 'RT Tester', ${JSON.stringify([])}, 'timed_out', now())`;
  }
  return { standupId: s.id, runId: run.id };
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("retrigger", () => {
  it("resets a timed_out report to in_progress, re-sends Q1, sets run running, schedules a timeout", async () => {
    const { standupId, runId: maybeRunId } = await seed({ report: "timed_out" });
    const runId = maybeRunId!; // the timed_out-report path always creates a run
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    await retrigger({ db, slack, enqueueTimeout }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [r] = await sql`select status, reported_at from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    expect(r.reported_at).toBeNull(); // reset clears the completed/timed-out timestamp
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("running");
    expect(slack.posts.some((p) => p.text === "What did you do?")).toBe(true); // Q1 re-sent
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0]).toEqual({ runId, slackUserId: USER });
  });

  it("opens the run + creates the report when no run exists yet", async () => {
    const { standupId } = await seed({ run: "no-run" });
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    await retrigger({ db, slack, enqueueTimeout }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [run] = await sql`select status from standup_runs where standup_id = ${standupId} and scheduled_date = current_date`;
    expect(run.status).toBe("running");
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
  });
});
