import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { getMemberDayState } from "./standupState";

const { db, sql } = createDb();
const CHAN = "C_SDS_TEST";
const USER = "U_SDS_TEST";          // member with a standup
const LONELY = "U_SDS_LONELY";      // member whose team has no standup
const STRANGER = "U_SDS_STRANGER";  // not a member at all
const CHAN2 = "C_SDS_NOSTANDUP";

let standupId: string;
let runId: string;

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id in (${CHAN}, ${CHAN2})))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id in (${CHAN}, ${CHAN2}))`;
  await sql`delete from team_members where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN}, ${CHAN2})`;
}

beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('SDS Pod', ${CHAN}, 'sds') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'SDS Tester', 'UTC', true)`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])},
            '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;

  const [team2] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('No Standup Pod', ${CHAN2}, 'nost') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team2.id}, ${LONELY}, 'Lonely', 'UTC', true)`;
});

beforeEach(async () => {
  await sql`delete from standup_reports where slack_user_id in (${USER}, ${LONELY}, ${STRANGER})`;
});

afterAll(async () => {
  await cleanup();
  await sql.end();
});

describe("getMemberDayState", () => {
  it("returns not_member for a user with no team_members row", async () => {
    const st = await getMemberDayState(db, STRANGER);
    expect(st.kind).toBe("not_member");
  });

  it("returns no_standup for a member whose team has no standup", async () => {
    const st = await getMemberDayState(db, LONELY);
    expect(st.kind).toBe("no_standup");
    expect(st.member?.slackDisplayName).toBe("Lonely");
  });

  it("returns pending when there is a run today but no report", async () => {
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("pending");
    expect(st.standup?.id).toBe(standupId);
    expect(st.total).toBe(2);
  });

  it("returns in_progress with answered/total when a report is in progress", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "did" }])}, 'in_progress')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("in_progress");
    expect(st.answered).toBe(1);
    expect(st.total).toBe(2);
  });

  it("returns completed when today's report is completed", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([])}, 'completed')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("completed");
  });

  it("returns pending when a prior report timed out", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status)
              values (${runId}, ${USER}, 'SDS Tester', ${JSON.stringify([])}, 'timed_out')`;
    const st = await getMemberDayState(db, USER);
    expect(st.kind).toBe("pending");
  });
});
