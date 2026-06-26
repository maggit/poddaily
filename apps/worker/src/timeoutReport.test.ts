import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "@poddaily/db";
import { timeoutReport } from "./timeoutReport";

const { db, sql } = createDb();
const CHAN = "C_TIMEOUT_TEST";
const USER = "U_TIMEOUT";

function fakeEnqueueTimeout() {
  const calls: Array<{ job: { runId: string; slackUserId: string }; delayMs: number }> = [];
  const fn = async (job: { runId: string; slackUserId: string }, opts: { delayMs: number }) => { calls.push({ job, delayMs: opts.delayMs }); };
  return Object.assign(fn, { calls });
}

async function seed(reportStatus: string, timeoutAt: Date | null): Promise<{ runId: string }> {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('TO Pod', ${CHAN}, 'to') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
  // Pass the timestamp as an ISO string with an explicit ::timestamptz cast rather than a raw
  // JS Date param: under vitest, postgres.js's `instanceof Date` type-inference runs against a
  // different module realm than the test's Date, so a bare Date param fails to serialize. The
  // implementation uses drizzle (typed columns), which is unaffected.
  const timeoutAtIso = timeoutAt === null ? null : timeoutAt.toISOString();
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, timeout_at) values (${run.id}, ${USER}, 'R', ${JSON.stringify([])}, ${reportStatus}, ${timeoutAtIso}::timestamptz)`;
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
  it("times out an in_progress report past its deadline and finalizes the run", async () => {
    const { runId } = await seed("in_progress", new Date(Date.now() - 1000));
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
    const [run] = await sql`select status from standup_runs where id = ${runId}`;
    expect(run.status).toBe("completed");
    expect(enqueueTimeout.calls).toHaveLength(0);
  });

  it("times out when timeout_at is null (legacy row)", async () => {
    const { runId } = await seed("in_progress", null);
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("timed_out");
  });

  it("reschedules (does NOT time out) when the deadline has moved into the future", async () => {
    const { runId } = await seed("in_progress", new Date(Date.now() + 60_000));
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("in_progress");
    expect(enqueueTimeout.calls).toHaveLength(1);
    expect(enqueueTimeout.calls[0].delayMs).toBeGreaterThan(0);
    expect(enqueueTimeout.calls[0].delayMs).toBeLessThanOrEqual(60_000);
  });

  it("is a no-op when the report already completed", async () => {
    const { runId } = await seed("completed", new Date(Date.now() - 1000));
    const enqueueTimeout = fakeEnqueueTimeout();
    await timeoutReport({ db, enqueueTimeout }, { runId, slackUserId: USER });
    const [r] = await sql`select status from standup_reports where slack_user_id = ${USER}`;
    expect(r.status).toBe("completed");
    expect(enqueueTimeout.calls).toHaveLength(0);
  });
});
