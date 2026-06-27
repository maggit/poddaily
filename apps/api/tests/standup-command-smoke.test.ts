import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleCommand } from "../src/handleCommand";
import type { RetriggerJob } from "@poddaily/shared";

const { db, sql } = createDb();
const CHAN = "C_SCSMK";
const USER = "U_SCSMK";
const DM = "D_SCSMK";
let standupId: string;
let runId: string;

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SC Pod', ${CHAN}, 'sc') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'SC Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;
});
beforeEach(async () => { await sql`delete from standup_reports where slack_user_id = ${USER}`; });
afterAll(async () => { await cleanup(); await sql.end(); });

describe("smoke:standup-cmd", () => {
  it("start → enqueues retrigger; status → pending; after completion → blocked", async () => {
    const jobs: RetriggerJob[] = [];
    const deps = { db, enqueueRetrigger: async (j: RetriggerJob) => { jobs.push(j); } };

    const started = await handleCommand(deps, { slackUserId: USER, text: "", channel: DM });
    expect(started).toContain("Starting your standup");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].standupId).toBe(standupId);

    const status = await handleCommand(deps, { slackUserId: USER, text: "status", channel: DM });
    expect(status).toContain("haven't reported today");

    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'SC Tester', ${JSON.stringify([])}, 'completed')`;
    const blocked = await handleCommand(deps, { slackUserId: USER, text: "start", channel: DM });
    expect(blocked).toContain("already reported today");
    expect(jobs).toHaveLength(1); // no new enqueue
  });
});
