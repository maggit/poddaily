import { createDb } from "@poddaily/db";
import { createQueue } from "./queue";
import { reconcileSchedules } from "./reconcileSchedules";

async function main() {
  const { db, sql } = createDb();
  const queue = createQueue();
  await reconcileSchedules(queue, db);
  await queue.close();
  await sql.end();
  console.log("[reconcile-cli] reconcile complete");
}

main().catch((err) => {
  console.error("[reconcile-cli] failed:", err);
  process.exit(1);
});
