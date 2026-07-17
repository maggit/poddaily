import { Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { SYNC_DIRECTORY_JOB, DIRECTORY_SYNC_SCHEDULER_ID, DIRECTORY_SYNC_EVERY_MS, PRUNE_LINEAR_JOB, PRUNE_LINEAR_SCHEDULER_ID, PRUNE_LINEAR_EVERY_MS, RECONCILE_JOB, RECONCILE_SCHEDULER_ID, RECONCILE_EVERY_MS } from "@poddaily/shared";
import { QUEUE_NAME, createQueue, redisConnection } from "./queue";
import { reconcileSchedules } from "./reconcileSchedules";
import { createProcessor } from "./processor";

async function main() {
  const { db } = createDb();
  const slack = createSlackClient();
  const queue = createQueue();

  await reconcileSchedules(queue, db);

  // Standup schedules also reconcile on demand (the web app enqueues RECONCILE_JOB after
  // any standup change) and periodically as a safety net, so a standup created or edited
  // from the web starts firing without a worker restart.
  await queue.upsertJobScheduler(
    RECONCILE_SCHEDULER_ID,
    { every: RECONCILE_EVERY_MS },
    { name: RECONCILE_JOB, data: {} },
  );

  // Keep the Slack workspace directory fresh for member search: a repeatable sync every
  // few hours, plus one immediate run at boot so the table populates on first deploy.
  await queue.upsertJobScheduler(
    DIRECTORY_SYNC_SCHEDULER_ID,
    { every: DIRECTORY_SYNC_EVERY_MS },
    { name: SYNC_DIRECTORY_JOB, data: {} },
  );
  await queue.add(SYNC_DIRECTORY_JOB, {}, { removeOnComplete: true, removeOnFail: false });

  // Daily retention prune of stored Linear activity.
  await queue.upsertJobScheduler(
    PRUNE_LINEAR_SCHEDULER_ID,
    { every: PRUNE_LINEAR_EVERY_MS },
    { name: PRUNE_LINEAR_JOB, data: {} },
  );

  const worker = new Worker(
    QUEUE_NAME,
    createProcessor({ db, slack, queue }),
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
