import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "./client";
import { finalizeRunIfDone } from "./runs";

const { db, sql } = createDb();
const CHAN = "C_RUNS_TEST";

async function seedRun(reportStatuses: string[]): Promise<string> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Runs Pod', ${CHAN}, 'runs') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  for (let i = 0; i < reportStatuses.length; i++) {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${run.id}, ${"U_RUNS_" + i}, 'R', ${JSON.stringify([])}, ${reportStatuses[i]})`;
  }
  return run.id;
}
async function cleanup() {
  await sql`delete from standup_reports where run_id in (select id from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})))`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("finalizeRunIfDone", () => {
  it("completes a run when all reports are terminal", async () => {
    const runId = await seedRun(["completed", "timed_out"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    const [run] = await sql`select status, completed_at from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(run.completed_at).not.toBeNull();
  });
  it("does nothing when a report is still in_progress", async () => {
    const runId = await seedRun(["completed", "in_progress"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(false);
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("running");
  });
  it("is idempotent — returns false on an already-completed run", async () => {
    const runId = await seedRun(["completed"]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    expect(await finalizeRunIfDone(db, runId)).toBe(false);
  });
  it("completes a zero-report run (vacuously terminal)", async () => {
    const runId = await seedRun([]);
    expect(await finalizeRunIfDone(db, runId)).toBe(true);
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
  });
});
