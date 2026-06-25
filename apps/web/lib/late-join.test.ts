import { describe, it, expect, afterAll } from "vitest";
import { enqueueLateJoinIfOpen } from "./late-join";
import { sql } from "./db";

const CHAN = "C_LATEJOIN";

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id like 'U_LJ_%'`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id like 'U_LJ_%'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
afterAll(async () => { await cleanup(); await sql.end(); });

async function seed(opts: { active?: boolean; runToday?: boolean; canReport?: boolean; withReport?: boolean; user?: string }): Promise<string> {
  await cleanup();
  const user = opts.user ?? "U_LJ_1";
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('LJ Pod', ${CHAN}, 'lj') returning id`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }])}, '0 9 * * 1,2,3,4,5', 'UTC', ${opts.active ?? true}) returning id`;
  let runId: string | null = null;
  if (opts.runToday) {
    const [r] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${s.id}, now(), current_date, 'running') returning id`;
    runId = r.id;
  }
  const [m] = await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report)
    values (${team.id}, ${user}, 'LJ Tester', 'UTC', ${opts.canReport ?? true}) returning id`;
  if (opts.withReport && runId) {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${user}, 'LJ Tester', ${JSON.stringify([])}, 'in_progress')`;
  }
  return m.id;
}

function spy() {
  const calls: any[] = [];
  const fn = async (job: any) => { calls.push(job); };
  return Object.assign(fn, { calls });
}

describe("enqueueLateJoinIfOpen", () => {
  it("enqueues a send-dm for a reporter with an open run and no report yet", async () => {
    const memberId = await seed({ runToday: true });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(1);
    expect(enqueue.calls[0].slackUserId).toBe("U_LJ_1");
    expect(enqueue.calls[0].runId).toBeTruthy();
    expect(enqueue.calls[0].standupId).toBeTruthy();
  });

  it("does nothing when no run is open today", async () => {
    const memberId = await seed({ runToday: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing for a non-reporting member", async () => {
    const memberId = await seed({ runToday: true, canReport: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing when the standup is paused", async () => {
    const memberId = await seed({ runToday: true, active: false });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });

  it("does nothing when the member already has a report for today's run", async () => {
    const memberId = await seed({ runToday: true, withReport: true });
    const enqueue = spy();
    await enqueueLateJoinIfOpen(memberId, enqueue);
    expect(enqueue.calls).toHaveLength(0);
  });
});
