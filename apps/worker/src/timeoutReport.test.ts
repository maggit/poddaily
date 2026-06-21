import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { timeoutReport } from "./timeoutReport";

const { db, sql } = createDb();
const CHAN = "C_TIMEOUT_TEST";
const USER = "U_TIMEOUT";

async function seed(reportStatus: string): Promise<{ runId: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('TO Pod', ${CHAN}, 'to') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${USER}, 'R', ${JSON.stringify([])}, ${reportStatus})`;
  return { runId: run.id };
}
async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("timeoutReport", () => {
  it("times out an in_progress report and finalizes the run", async () => {
    const { runId } = await seed("in_progress");
    await timeoutReport({ db }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
  });
  it("is a no-op when the report already completed", async () => {
    const { runId } = await seed("completed");
    await timeoutReport({ db }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("completed");
  });
});
