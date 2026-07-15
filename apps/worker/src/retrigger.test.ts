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
    getPermalink: async () => null,
    getUserProfile: async () => ({ image: null, tz: null, realName: null }),
    listAllUsers: async () => [],
  };
}
function fakeEnqueueTimeout() {
  const calls: Array<{ runId: string; slackUserId: string }> = [];
  const fn = async (job: { runId: string; slackUserId: string }) => { calls.push(job); };
  return Object.assign(fn, { calls });
}
function fakeEnqueueSend() {
  const calls: Array<{ slackUserId: string }> = [];
  const fn = async (job: { slackUserId: string }) => { calls.push({ slackUserId: job.slackUserId }); };
  return Object.assign(fn, { calls });
}
function fakeEnqueueReminders() {
  const calls: any[] = [];
  const fn = async (job: any, opts: any) => { calls.push({ job, opts }); };
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
    const enqueueSend = fakeEnqueueSend();
    const enqueueReminders = fakeEnqueueReminders();
    await retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [r] = await sql`select status, reported_at from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    expect(r.reported_at).toBeNull(); // reset clears the completed/timed-out timestamp
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("running");
    expect(slack.posts.some((p) => p.text === "What did you do?")).toBe(true); // Q1 re-sent
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0]).toEqual({ runId, slackUserId: USER });
    const [rep] = await sql`select timeout_at from standup_reports where slack_user_id = ${USER}`;
    expect(rep.timeout_at).not.toBeNull();
    expect(new Date(rep.timeout_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("opens the run + creates the report when no run exists yet", async () => {
    const { standupId } = await seed({ run: "no-run" });
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    const enqueueSend = fakeEnqueueSend();
    const enqueueReminders = fakeEnqueueReminders();
    await retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [run] = await sql`select status from standup_runs where standup_id = ${standupId} and scheduled_date = current_date`;
    expect(run.status).toBe("running");
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
  });

  it("no-ops (no wipe, no re-DM) when the report is already in_progress — a delayed retry", async () => {
    const { standupId, runId } = await seed({ report: "timed_out" }); // creates run + timed_out report
    // simulate the member already mid-answer: in_progress with one answer
    await sql`update standup_reports set status = 'in_progress', answers = ${JSON.stringify([{ questionId: "q1", questionText: "What did you do?", answer: "already typed this" }])} where slack_user_id = ${USER}`;
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    const enqueueSend = fakeEnqueueSend();
    const enqueueReminders = fakeEnqueueReminders();
    await retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    const [r] = await sql`select status, answers from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    expect(r.answers).toHaveLength(1); // NOT wiped
    expect(slack.posts).toHaveLength(0); // no re-DM
    expect(enqueueTimeout.calls).toHaveLength(0);
    void runId;
  });

  it("fans out the whole team (excluding the requester) when it opens a run the scheduler hadn't", async () => {
    const { standupId } = await seed({ run: "no-run" }); // standup + requester member, NO run
    // add a second reporting member who should receive the team fan-out
    const [team] = await sql`select id from teams where slack_channel_id = ${CHAN}`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, 'U_RETRIG_2', 'RT Two', 'UTC', true)`;
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    const enqueueSend = fakeEnqueueSend();
    const enqueueReminders = fakeEnqueueReminders();
    await retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    // requester recovered directly
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    // the OTHER member was fanned out a send-dm; the requester was NOT (gets the direct re-DM)
    expect(enqueueSend.calls.map((c) => c.slackUserId)).toEqual(["U_RETRIG_2"]);
    await sql`delete from team_members where slack_user_id = 'U_RETRIG_2'`;
    await sql`delete from standup_reports where slack_user_id = 'U_RETRIG_2'`;
  });

  it("stays self-scoped (no team fan-out) when today's run already exists", async () => {
    const { standupId } = await seed({ report: "timed_out" }); // run already exists + requester timed_out
    const [team] = await sql`select id from teams where slack_channel_id = ${CHAN}`;
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, 'U_RETRIG_2', 'RT Two', 'UTC', true)`;
    const slack = fakeSlack();
    const enqueueTimeout = fakeEnqueueTimeout();
    const enqueueSend = fakeEnqueueSend();
    const enqueueReminders = fakeEnqueueReminders();
    await retrigger({ db, slack, enqueueSend, enqueueTimeout, enqueueReminders }, { standupId, slackUserId: USER, slackDisplayName: "RT Tester", channel: "D_RT" });
    expect(enqueueSend.calls).toHaveLength(0); // run existed → no team fan-out
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    await sql`delete from team_members where slack_user_id = 'U_RETRIG_2'`;
    await sql`delete from standup_reports where slack_user_id = 'U_RETRIG_2'`;
  });
});
