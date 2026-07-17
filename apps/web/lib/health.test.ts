import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getStandupHealth } from "./health";
import { sql } from "./db";
import { cronFromWeekly } from "@poddaily/shared";

const CHAN = "C_TEST_HEALTH";
// 09:00 Mon-Fri
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

async function seed(opts: { active?: boolean } = {}) {
  const [team] = await sql`
    insert into teams (name, slack_channel_id, slack_channel_name)
    values ('Health Pod', ${CHAN}, 'health-pod') returning id`;
  await sql`
    insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report)
    values (${team.id}, 'U_H1', 'H One', 'UTC', true),
           (${team.id}, 'U_H2', 'H Two', 'UTC', true),
           (${team.id}, 'U_H3', 'Lurker', 'UTC', false)`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])},
            ${CRON}, 'UTC', ${opts.active ?? true}) returning id`;
  return { teamId: team.id as string, standupId: s.id as string };
}

function findPod(rows: Awaited<ReturnType<typeof getStandupHealth>>) {
  return rows.find((r) => r.slackChannelName === "health-pod");
}

beforeEach(async () => {
  await sql`delete from team_members where slack_user_id in ('U_H1','U_H2','U_H3')`;
  await sql`delete from standup_reports where run_id in (select r.id from standup_runs r join standups s on s.id = r.standup_id join teams t on t.id = s.team_id where t.slack_channel_id = ${CHAN})`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
});
afterAll(async () => { await sql.end(); });

describe("getStandupHealth", () => {
  it("reports 'missed' when a scheduled day's send time passed with no run (the new-standup bug)", async () => {
    await seed();
    // Wed 2026-06-17 12:00Z — a Mon-Fri weekday, after the 09:00 slot, no run row.
    const rows = await getStandupHealth(new Date("2026-06-17T12:00:00Z"));
    const pod = findPod(rows)!;
    expect(pod.state).toBe("missed");
    expect(pod.reporters).toBe(2);
    expect(pod.lastRun).toBeNull();
    expect(pod.nextRunAt?.toISOString()).toBe("2026-06-18T09:00:00.000Z");
  });

  it("reports 'waiting' before the send time on a scheduled day", async () => {
    await seed();
    const rows = await getStandupHealth(new Date("2026-06-17T06:00:00Z")); // before 09:00
    expect(findPod(rows)!.state).toBe("waiting");
  });

  it("reports 'running' with DM + report counts once today's run opened", async () => {
    const { standupId } = await seed();
    const now = new Date("2026-06-17T12:00:00Z");
    const [run] = await sql`
      insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, started_at)
      values (${standupId}, '2026-06-17T12:00:00Z'::timestamptz, '2026-06-17', 'running', '2026-06-17T12:00:00Z'::timestamptz) returning id`;
    await sql`
      insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
      values (${run.id}, 'U_H1', 'H One', '[]'::jsonb, 'completed'),
             (${run.id}, 'U_H2', 'H Two', '[]'::jsonb, 'in_progress')`;

    const pod = findPod(await getStandupHealth(now))!;
    expect(pod.state).toBe("running");
    expect(pod.lastRun).toMatchObject({ isToday: true, dmSent: 2, completed: 1, inProgress: 1, timedOut: 0 });
  });

  it("reports 'completed' when today's run is completed", async () => {
    const { standupId } = await seed();
    const now = new Date("2026-06-17T18:00:00Z");
    await sql`
      insert into standup_runs (standup_id, scheduled_at, scheduled_date, status, started_at, completed_at)
      values (${standupId}, '2026-06-17T18:00:00Z'::timestamptz, '2026-06-17', 'completed', '2026-06-17T18:00:00Z'::timestamptz, '2026-06-17T18:00:00Z'::timestamptz)`;
    expect(findPod(await getStandupHealth(now))!.state).toBe("completed");
  });

  it("reports 'paused' for an inactive standup regardless of schedule", async () => {
    await seed({ active: false });
    expect(findPod(await getStandupHealth(new Date("2026-06-17T12:00:00Z")))!.state).toBe("paused");
  });

  it("reports 'unconfigured' for a team with no standup", async () => {
    await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Health Pod', ${CHAN}, 'health-pod')`;
    expect(findPod(await getStandupHealth())!.state).toBe("unconfigured");
  });
});
