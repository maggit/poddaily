// Container HEALTHCHECK probe for the worker (which serves no HTTP): verifies its two
// backends — Postgres and Redis — are reachable, then exits 0/1. Bundled to
// dist/healthcheck.mjs in the Docker image and run by the compose healthcheck.
import { createDb } from "@poddaily/db";
import { Queue } from "bullmq";
import { QUEUE_NAME } from "@poddaily/shared";

// Hard deadline: ioredis retries forever by default, so a down Redis would otherwise hang
// the probe instead of failing it.
const deadline = setTimeout(() => {
  console.error("[healthcheck] timed out");
  process.exit(1);
}, 5000);
deadline.unref();

try {
  const { sql } = createDb();
  await sql`select 1`;
  await sql.end();

  const queue = new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
  await (await queue.client).ping();
  await queue.close();

  process.exit(0);
} catch (err) {
  console.error("[healthcheck] failed:", err);
  process.exit(1);
}
