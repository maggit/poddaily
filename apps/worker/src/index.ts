import { Worker } from "bullmq";
import { createDb } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
import { QUEUE_NAME, createQueue, redisConnection } from "./queue";
import { reconcileSchedules } from "./reconcileSchedules";
import { createProcessor } from "./processor";

async function main() {
  const { db } = createDb();
  const slack = createSlackClient();
  const queue = createQueue();

  await reconcileSchedules(queue, db);

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
