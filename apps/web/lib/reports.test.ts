import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "./db";
import { getTodayOverview, getRunDetail, listTeamRunDates } from "./reports";

const CHAN = "C_REPORTS_TEST";
let teamId = "";
let standupId = "";
let todayRunId = "";

async function cleanup() {
  await sql`delete from standup_reports where run_id in (select id from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})))`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql`delete from linear_activity where assignee_email = 'u_a@reports.test'`;
  await sql`delete from slack_directory_users where slack_user_id = 'U_A'`;
}

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Reports Pod', ${CHAN}, 'rep') returning id`;
  teamId = team.id;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${teamId}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Since {last_report_date}?", type: "text" }, { id: "q2", text: "Today?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  // members: A reports, B times out, C absent (no report row)
  for (const u of ["U_A", "U_B", "U_C"]) {
    await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report, slack_avatar_url) values (${teamId}, ${u}, ${"Member " + u}, 'UTC', true, ${u === "U_A" ? "https://x/a.png" : null})`;
  }
  // a PRIOR completed report for A (for {last_report_date} interpolation)
  const [prevRun] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, '2026-06-20T10:00:00Z', '2026-06-20', 'completed') returning id`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, reported_at, created_at) values (${prevRun.id}, 'U_A', 'Member U_A', ${JSON.stringify([])}, 'completed', '2026-06-20T10:00:00Z', '2026-06-20T10:00:00Z')`;
  // TODAY's run
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'running') returning id`;
  todayRunId = run.id;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${todayRunId}, 'U_A', 'Member U_A', ${JSON.stringify([{ questionId: "q1", questionText: "Since {last_report_date}?", answer: "shipped" }, { questionId: "q2", questionText: "Today?", answer: "more" }])}, 'completed')`;
  await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${todayRunId}, 'U_B', 'Member U_B', ${JSON.stringify([])}, 'timed_out')`;
  // U_C has no report row → absent

  // U_A is matched to Linear activity by directory email; one issue completed inside the window
  // [last report 2026-06-20 .. now]. U_B/U_C have no email → no activity.
  await sql`insert into slack_directory_users (slack_user_id, display_name, email) values ('U_A', 'Member U_A', 'u_a@reports.test')`;
  await sql`insert into linear_activity (linear_issue_id, identifier, title, url, state_type, assignee_email, completed_at)
            values ('rep-iss-1', 'ENG-1', 'Did a thing', 'https://linear.app/x/ENG-1', 'completed', 'u_a@reports.test', '2026-06-25T10:00:00Z')`;
});
afterAll(async () => { await cleanup(); await sql.end(); });

describe("getTodayOverview", () => {
  it("lists today's run with participation counts", async () => {
    const rows = await getTodayOverview();
    const row = rows.find((r) => r.teamId === teamId);
    expect(row).toBeTruthy();
    expect(row!.run?.status).toBe("running");
    expect(row!.total).toBe(2);     // A + B have report rows today
    expect(row!.reported).toBe(1);  // only A completed
  });
});

describe("getRunDetail", () => {
  it("returns a card per can_report member with statuses + interpolated answers", async () => {
    const detail = await getRunDetail(teamId);
    expect(detail).toBeTruthy();
    expect(detail!.run?.scheduledDate).toBeTruthy();
    const cards = detail!.cards;
    expect(cards.map((c) => c.slackUserId).sort()).toEqual(["U_A", "U_B", "U_C"]);
    const a = cards.find((c) => c.slackUserId === "U_A")!;
    expect(a.status).toBe("completed");
    expect(a.avatarUrl).toBe("https://x/a.png");
    expect(a.answers[0].question).not.toContain("{last_report_date}"); // interpolated
    expect(a.answers[0].question).toContain("Jun 20");
    expect(cards.find((c) => c.slackUserId === "U_B")!.status).toBe("timed_out");
    expect(cards.find((c) => c.slackUserId === "U_C")!.status).toBe("absent");
    // U_A's completed Linear issue surfaces on the card; unmatched members have none.
    expect(a.linearIssues.map((i) => i.identifier)).toContain("ENG-1");
    expect(cards.find((c) => c.slackUserId === "U_B")!.linearIssues).toHaveLength(0);
  });
  it("returns null for an unknown team", async () => {
    expect(await getRunDetail("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("listTeamRunDates", () => {
  it("lists recent runs newest-first with counts", async () => {
    const dates = await listTeamRunDates(teamId);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(new Date(dates[0].date) >= new Date(dates[1].date)).toBe(true); // desc
  });
});
