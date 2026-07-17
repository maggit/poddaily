import { createQueue, enqueueOpenRun } from "./queue";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const standupId = args.find((a) => a !== "--force");
  if (!standupId) {
    console.error("usage: pnpm --filter @poddaily/worker trigger <standupId> [--force]");
    process.exit(1);
  }
  const queue = createQueue();
  await enqueueOpenRun(queue, standupId, { force });
  await queue.close();
  console.log(`[trigger] enqueued open-run for standup ${standupId}${force ? " (force)" : ""}`);
}

main().catch((err) => {
  console.error("[trigger] failed:", err);
  process.exit(1);
});
