import { createQueue, enqueueOpenRun } from "./queue";

async function main() {
  const standupId = process.argv[2];
  if (!standupId) {
    console.error("usage: pnpm --filter @poddaily/worker trigger <standupId>");
    process.exit(1);
  }
  const queue = createQueue();
  await enqueueOpenRun(queue, standupId);
  await queue.close();
  console.log(`[trigger] enqueued open-run for standup ${standupId}`);
}

main().catch((err) => {
  console.error("[trigger] failed:", err);
  process.exit(1);
});
