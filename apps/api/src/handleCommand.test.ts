import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@poddaily/db";
import { handleCommand, parseSubcommand, formatStatus, formatHelp } from "./handleCommand";
import type { MemberDayState } from "./standupState";
import type { RetriggerJob } from "@poddaily/shared";

const { db, sql } = createDb();
const CHAN = "C_HC_TEST";
const USER = "U_HC_TEST";
const DM = "D_HC_TEST";
let standupId: string;
let runId: string;

function recorder() {
  const jobs: RetriggerJob[] = [];
  return { jobs, enqueueRetrigger: async (j: RetriggerJob) => { jobs.push(j); } };
}
const state = (kind: MemberDayState["kind"], answered = 0, total = 2): MemberDayState =>
  ({ kind, answered, total, member: { teamId: "t", slackDisplayName: "X" }, standup: { id: "s", scheduleTz: "UTC" } });

async function cleanup() {
  await sql`delete from standup_reports where slack_user_id = ${USER}`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeAll(async () => {
  await cleanup();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('HC Pod', ${CHAN}, 'hc') returning id`;
  await sql`insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report) values (${team.id}, ${USER}, 'HC Tester', 'UTC', true)`;
  const [s] = await sql`insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup', ${JSON.stringify([{ id: "q1", text: "Q1?", type: "text" }, { id: "q2", text: "Q2?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
  standupId = s.id;
  const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standupId}, now(), current_date, 'open') returning id`;
  runId = run.id;
});
beforeEach(async () => { await sql`delete from standup_reports where slack_user_id = ${USER}`; });
afterAll(async () => { await cleanup(); await sql.end(); });

describe("parseSubcommand", () => {
  it("maps empty and 'start' to start, 'status' to status, everything else to help", () => {
    expect(parseSubcommand("")).toBe("start");
    expect(parseSubcommand("  ")).toBe("start");
    expect(parseSubcommand("start")).toBe("start");
    expect(parseSubcommand("STATUS")).toBe("status");
    expect(parseSubcommand(" status ")).toBe("status");
    expect(parseSubcommand("help")).toBe("help");
    expect(parseSubcommand("wat")).toBe("help");
  });
});

describe("formatStatus / formatHelp (pure)", () => {
  it("formats each state", () => {
    expect(formatStatus(state("completed"))).toContain("reported today");
    expect(formatStatus(state("in_progress", 1, 2))).toContain("1 of 2");
    expect(formatStatus(state("pending"))).toContain("haven't reported today");
    expect(formatStatus(state("not_member"))).toContain("not set up");
    expect(formatStatus(state("no_standup"))).toContain("not set up");
    expect(formatStatus(state("paused"))).toContain("paused");
  });
  it("help lists all three commands", () => {
    const h = formatHelp();
    expect(h).toContain("/standup status");
    expect(h).toContain("/standup help");
    expect(h).toContain("start your standup");
  });
});

describe("handleCommand", () => {
  const cmd = (text: string) => ({ slackUserId: USER, text, channel: DM });

  it("help returns the command list and does not enqueue", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("help"));
    expect(reply).toContain("/standup status");
    expect(r.jobs).toHaveLength(0);
  });

  it("start with a pending state enqueues a retrigger and says starting", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd(""));
    expect(reply).toContain("Starting your standup");
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ standupId, slackUserId: USER, slackDisplayName: "HC Tester", channel: DM });
  });

  it("start when already completed blocks and does not enqueue", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([])}, 'completed')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("start"));
    expect(reply).toContain("already reported today");
    expect(r.jobs).toHaveLength(0);
  });

  it("start when in progress tells them to check DMs and does not enqueue", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "x" }])}, 'in_progress')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("start"));
    expect(reply).toContain("in progress");
    expect(r.jobs).toHaveLength(0);
  });

  it("status reflects an in-progress report", async () => {
    await sql`insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status) values (${runId}, ${USER}, 'HC Tester', ${JSON.stringify([{ questionId: "q1", questionText: "Q1?", answer: "x" }])}, 'in_progress')`;
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("status"));
    expect(reply).toContain("1 of 2");
  });

  it("unknown subcommand falls back to help", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, cmd("frobnicate"));
    expect(reply).toContain("/standup help");
    expect(r.jobs).toHaveLength(0);
  });

  it("start for a non-member returns not-set-up and does not enqueue", async () => {
    const r = recorder();
    const reply = await handleCommand({ db, ...r }, { slackUserId: "U_HC_STRANGER", text: "", channel: DM });
    expect(reply).toContain("not set up");
    expect(r.jobs).toHaveLength(0);
  });

  it("start when the standup is paused blocks and does not enqueue", async () => {
    await sql`update standups set is_active = false where id = ${standupId}`;
    try {
      const r = recorder();
      const reply = await handleCommand({ db, ...r }, cmd("start"));
      expect(reply).toContain("paused");
      expect(r.jobs).toHaveLength(0);
    } finally {
      await sql`update standups set is_active = true where id = ${standupId}`;
    }
  });

  it("status when the standup is paused says paused", async () => {
    await sql`update standups set is_active = false where id = ${standupId}`;
    try {
      const r = recorder();
      const reply = await handleCommand({ db, ...r }, cmd("status"));
      expect(reply).toContain("paused");
    } finally {
      await sql`update standups set is_active = true where id = ${standupId}`;
    }
  });
});
