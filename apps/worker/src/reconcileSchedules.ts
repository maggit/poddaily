import { createDb, schema, eq } from "@poddaily/db";
import { deriveTickCron, OPEN_RUN_JOB } from "@poddaily/shared";
import { createQueue } from "./queue";
import { diffSchedules, type ActiveStandup, type ExistingJob } from "./reconcile";

const REPEAT_NAME = OPEN_RUN_JOB; // repeatable job name

/** Reconcile repeatable open-run jobs against the active standups. */
export async function reconcileSchedules(
  queue: ReturnType<typeof createQueue>,
  db: ReturnType<typeof createDb>["db"],
) {
  const rows = await db
    .select({ id: schema.standups.id, scheduleCron: schema.standups.scheduleCron, scheduleTz: schema.standups.scheduleTz })
    .from(schema.standups)
    .where(eq(schema.standups.isActive, true));

  // CARRIED CONCERN (a): a single malformed scheduleCron must NOT crash reconciliation
  // for all standups. Filter out (and log) any standup whose tick cron can't be derived.
  const active: ActiveStandup[] = [];
  for (const r of rows) {
    try {
      deriveTickCron(r.scheduleCron); // throws on unparseable cron
      active.push({ id: r.id, scheduleCron: r.scheduleCron, scheduleTz: r.scheduleTz });
    } catch (err) {
      console.error(`[reconcile] skipping standup ${r.id} — bad scheduleCron ${JSON.stringify(r.scheduleCron)}:`, (err as Error).message);
    }
  }

  // VERIFIED (bullmq 5.79.0): Job Schedulers API. getJobSchedulers() returns JobSchedulerJson[]
  // where the scheduler id we passed to upsertJobScheduler is on `.key` (NOT `.id`, which is
  // undefined for pattern-based schedulers). `.pattern` and `.tz` round-trip exactly the values
  // we wrote, so the diff below produces no churn when standups are unchanged (CARRIED CONCERN b).
  const repeatables = await queue.getJobSchedulers();
  const existing: ExistingJob[] = repeatables
    .filter((r) => r.name === REPEAT_NAME && r.key)
    .map((r) => ({ standupId: r.key, pattern: r.pattern ?? "", tz: r.tz ?? "" }));

  const { toAdd, toRemove } = diffSchedules(active, existing);
  for (const r of toRemove) {
    await queue.removeJobScheduler(r.standupId); // scheduler id == standupId == JobSchedulerJson.key
  }
  for (const a of toAdd) {
    // scheduler id MUST be the standupId so the open-run job carries { standupId } and removal by id works.
    await queue.upsertJobScheduler(
      a.standupId,
      { pattern: a.pattern, tz: a.tz },
      { name: REPEAT_NAME, data: { standupId: a.standupId } },
    );
  }
  console.log(`[reconcile] active=${active.length} added=${toAdd.length} removed=${toRemove.length}`);
}
