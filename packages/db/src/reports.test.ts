import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "./client";
import { lastReportDateBefore } from "./reports";

const { db, sql } = createDb();
const CHAN = "C_LRD_TEST";
const USER = "U_LRD";

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
async function seedReport(status: string, reportedAt: string): Promise<void> {
  // ensure a team/standup/run exist (reuse one run is fine; we only query by slack_user_id+status)
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('LRD', ${CHAN}, 'lrd') on conflict (slack_channel_id) do update set name='LRD' returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz) values (${team.id}, 'S', ${JSON.stringify([{ id: "q1", text: "Q?", type: "text" }])}, '0 10 * * 1', 'UTC') on conflict (team_id) do update set name='S' returning id`;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, ${reportedAt}, ${reportedAt}::date, 'completed') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, reported_at) values (${run.id}, ${USER}, 'R', ${JSON.stringify([])}, ${status}, ${reportedAt})`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

describe("lastReportDateBefore", () => {
  it("returns the most recent completed report strictly before the cutoff", async () => {
    await cleanup();
    await seedReport("completed", "2026-06-18T10:00:00Z");
    await seedReport("completed", "2026-06-20T10:00:00Z");
    const before = new Date("2026-06-22T10:00:00Z");
    const d = await lastReportDateBefore(db, USER, before);
    expect(d?.toISOString()).toBe(new Date("2026-06-20T10:00:00Z").toISOString());
  });
  it("excludes reports at/after the cutoff (the current run)", async () => {
    await cleanup();
    await seedReport("completed", "2026-06-20T10:00:00Z");
    await seedReport("completed", "2026-06-22T09:00:00Z"); // the 'current' one
    const before = new Date("2026-06-22T09:00:00Z");
    const d = await lastReportDateBefore(db, USER, before);
    expect(d?.toISOString()).toBe(new Date("2026-06-20T10:00:00Z").toISOString());
  });
  it("ignores non-completed (timed_out) reports", async () => {
    await cleanup();
    await seedReport("timed_out", "2026-06-20T10:00:00Z");
    expect(await lastReportDateBefore(db, USER, new Date("2026-06-22T10:00:00Z"))).toBeNull();
  });
  it("returns null when there is no prior report", async () => {
    await cleanup();
    expect(await lastReportDateBefore(db, USER, new Date("2026-06-22T10:00:00Z"))).toBeNull();
  });
});
