import { Worker, type Job } from "bullmq";
import { createDb, schema, eq } from "@poddaily/db";
import { deriveTickCron } from "@poddaily/shared";
import { createSlackClient } from "@poddaily/slack-client";
import { QUEUE_NAME, createQueue, makeEnqueueSend, redisConnection, enqueueOpenRun } from "./queue";
import { diffSchedules, type ActiveStandup, type ExistingJob } from "./reconcile";
import { openRun } from "./openRun";
import { sendDm } from "./sendDm";
import type { SendDmJob } from "./types";

const REPEAT_NAME = "open-run"; // repeatable job name

/** Reconcile repeatable open-run jobs against the active standups. */
async function reconcile(queue: ReturnType<typeof createQueue>, db: ReturnType<typeof createDb>["db"]) {
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

async function main() {
  const { db } = createDb();
  const slack = createSlackClient();
  const queue = createQueue();

  await reconcile(queue, db);

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "open-run") {
        const { standupId } = job.data as { standupId: string };
        await openRun({ db, enqueueSend: makeEnqueueSend(queue) }, standupId, new Date());
      } else if (job.name === "send-dm") {
        await sendDm({ db, slack }, job.data as SendDmJob);
      } else {
        throw new Error(`[worker] unknown job name: ${job.name}`);
      }
    },
    { connection: redisConnection() },
  );

  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} (${job?.name}) failed:`, err.message));
  worker.on("completed", (job) => console.log(`[worker] job ${job.id} (${job.name}) done`));
  console.log("[worker] started");

  // Graceful shutdown so in-flight jobs aren't left stalled on container stop.
  const shutdown = async () => {
    console.log("[worker] shutting down");
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
