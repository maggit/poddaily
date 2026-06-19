import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue } from "bullmq";
import { createDb } from "@poddaily/db";
import { cronFromWeekly, deriveTickCron } from "@poddaily/shared";
import { reconcileSchedules } from "../src/reconcileSchedules";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const QUEUE_NAME = "reconcile-test"; // isolated queue name distinct from "standup"/"standup-smoke"
const CHAN = "C_RECONCILE_TEST";
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });
const SCHEDULE_TZ = "America/Mexico_City";
const EXPECTED_PATTERN = deriveTickCron(CRON); // "5 0 * * 1,2,3,4,5"

const { db, sql } = createDb();
let queue: Queue;
let standupId: string;

async function cleanDb() {
  await sql`delete from standup_runs where standup_id in (select id from standups where team_id in (select id from teams where slack_channel_id = ${CHAN}))`;
  await sql`delete from standups where team_id in (select id from teams where slack_channel_id = ${CHAN})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}

beforeAll(async () => {
  queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
  await queue.obliterate({ force: true }); // clean slate

  await cleanDb();
  const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Reconcile Pod', ${CHAN}, 'reconcile') returning id`;
  // Seed questions via JSON.stringify — the pooler runs prepare:false; sql.json does NOT work.
  const [s] = await sql`
    insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
    values (${team.id}, 'Daily Standup',
            ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])},
            ${CRON}, ${SCHEDULE_TZ}, true) returning id`;
  standupId = s.id;
});

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  await cleanDb();
  await sql.end();
});

// reconcileSchedules reconciles ALL active standups globally, and the shared Postgres
// may already hold other active standups (seed data). Scope every assertion to OUR
// seeded standup by filtering schedulers on .key === standupId so the test is robust
// to that shared state while still proving the wiring + no-churn property for our row.
async function mine() {
  return (await queue.getJobSchedulers()).filter((s) => s.key === standupId);
}

describe("reconcileSchedules (real Redis wiring)", () => {
  it("creates exactly one scheduler whose key/name/pattern/tz round-trip the standup", async () => {
    await reconcileSchedules(queue, db);

    const schedulers = await mine();
    expect(schedulers).toHaveLength(1);
    const sch = schedulers[0];
    expect(sch.key).toBe(standupId); // scheduler id round-trips on .key (NOT .id)
    expect(sch.name).toBe("open-run");
    expect(sch.pattern).toBe(EXPECTED_PATTERN);
    expect(sch.tz).toBe(SCHEDULE_TZ);
  });

  it("does not churn on a second reconcile with the standup unchanged", async () => {
    const before = await mine();
    expect(before).toHaveLength(1);
    const b = before[0];

    await reconcileSchedules(queue, db);

    const after = await mine();
    expect(after).toHaveLength(1);
    const a = after[0];
    // No-churn: if the ExistingJob mapping didn't round-trip, this second call would
    // remove+recreate the scheduler. Assert identity of key/pattern/tz AND the next fire time.
    expect(a.key).toBe(b.key);
    expect(a.pattern).toBe(b.pattern);
    expect(a.tz).toBe(b.tz);
    expect(a.next).toBe(b.next);
  });

  it("removes the scheduler when the standup is deactivated", async () => {
    await sql`update standups set is_active = false where id = ${standupId}`;

    await reconcileSchedules(queue, db);

    const schedulers = await mine();
    expect(schedulers).toHaveLength(0);
  });
});
