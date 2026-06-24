import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb, schema, eq } from "@poddaily/db";
import { cronFromWeekly } from "@poddaily/shared";
import { openRun, ensureRunOpen } from "./openRun";
import type { SendDmJob } from "./types";

const { db, sql } = createDb();

function fakeSlack() {
  const posts: Array<{ channel: string; text: string }> = [];
  return {
    posts,
    openDm: async () => "D_FAKE",
    postMessage: async (channel: string, text: string) => { posts.push({ channel, text }); return "ts_open"; },
    updateMessage: async () => {},
    getUserProfile: async () => ({ image: null, tz: null, realName: null }),
  };
}

const CHAN = "C_OPENRUN";
// "09:00 Mon-Fri"
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

async function seedStandup(active = true) {
  const [team] = await sql`
    insert into teams (name, slack_channel_id, slack_channel_name)
    values ('OpenRun Pod', ${CHAN}, 'openrun-pod') returning id`;
  await sql`
    insert into team_members (team_id, slack_user_id, slack_display_name, timezone, can_report)
    values (${team.id}, 'U_NY', 'NY User', 'America/New_York', true),
           (${team.id}, 'U_LDN', 'London User', 'Europe/London', true),
           (${team.id}, 'U_NOREPORT', 'Lurker', 'UTC', false)`;
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])},
            ${CRON}, 'UTC', ${active})
    returning id`;
  return s.id as string;
}

beforeEach(async () => {
  await sql`delete from team_members where slack_user_id in ('U_NY','U_LDN','U_NOREPORT')`;
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
});
afterAll(async () => { await sql.end(); });

describe("openRun", () => {
  it("opens one run and enqueues a send per reporting member", async () => {
    const standupId = await seedStandup();
    const enqueued: Array<{ job: SendDmJob; delayMs: number }> = [];
    const now = new Date("2026-06-17T00:05:00Z"); // Wednesday, before any member 09:00
    const slack = fakeSlack();

    const result = await openRun({ db, enqueueSend: async (job, opts) => { enqueued.push({ job, delayMs: opts.delayMs }); }, slack }, standupId, now);

    expect(result.runId).toBeTruthy();
    expect(result.enqueued).toBe(2); // U_NOREPORT excluded
    const users = enqueued.map((e) => e.job.slackUserId).sort();
    expect(users).toEqual(["U_LDN", "U_NY"]);
    // London 09:00 BST = 08:00Z → delay ~ 7h55m from 00:05Z
    const ldn = enqueued.find((e) => e.job.slackUserId === "U_LDN")!;
    expect(ldn.delayMs).toBeGreaterThan(0);
    // a row exists
    const runs = await sql`select * from standup_runs where id = ${result.runId}`;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
    // the channel opening message was posted with the live counter and its ts stored
    expect(slack.posts.some((p) => p.channel === CHAN && p.text.includes("Reported: 0 out of"))).toBe(true);
    const [openedRun] = await sql`select channel_opening_ts from standup_runs where id = ${result.runId}`;
    expect(openedRun.channel_opening_ts).toBe("ts_open");
  });

  it("is idempotent — a second openRun for the same day enqueues nothing new", async () => {
    const standupId = await seedStandup();
    const now = new Date("2026-06-17T00:05:00Z");
    const slack = fakeSlack();
    const first: SendDmJob[] = [];
    await openRun({ db, enqueueSend: async (j) => { first.push(j); }, slack }, standupId, now);
    const second: SendDmJob[] = [];
    const r2 = await openRun({ db, enqueueSend: async (j) => { second.push(j); }, slack }, standupId, now);
    expect(second).toHaveLength(0);
    expect(r2.runId).toBeNull();
    expect(r2.enqueued).toBe(0);
    const runs = await sql`select count(*)::int as n from standup_runs where standup_id = ${standupId}`;
    expect(runs[0].n).toBe(1);
  });

  it("does nothing on an inactive weekday", async () => {
    const standupId = await seedStandup();
    const sat = new Date("2026-06-20T00:05:00Z"); // Saturday
    const enq: SendDmJob[] = [];
    const slack = fakeSlack();
    const r = await openRun({ db, enqueueSend: async (j) => { enq.push(j); }, slack }, standupId, sat);
    expect(r.runId).toBeNull();
    expect(enq).toHaveLength(0);
  });

  it("does nothing for an inactive standup", async () => {
    const standupId = await seedStandup(false);
    const now = new Date("2026-06-17T00:05:00Z");
    const enq: SendDmJob[] = [];
    const slack = fakeSlack();
    const r = await openRun({ db, enqueueSend: async (j) => { enq.push(j); }, slack }, standupId, now);
    expect(r.runId).toBeNull();
    expect(enq).toHaveLength(0);
  });

  it("ensureRunOpen opens a run with an opening message and returns the existing run on a second call", async () => {
    const standupId = await seedStandup();
    const [standupRow] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
    const now = new Date("2026-06-17T00:05:00Z"); // Wednesday
    const slack = fakeSlack();

    const first = await ensureRunOpen({ db, slack }, standupRow, now);
    expect(first.created).toBe(true);
    expect(first.run.id).toBeTruthy();
    // opening message posted on first open (buildOpeningMessage text mentions the reported/total count)
    expect(slack.posts.length).toBeGreaterThan(0);

    const second = await ensureRunOpen({ db, slack }, standupRow, now);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id); // same run, not a duplicate
  });
});
