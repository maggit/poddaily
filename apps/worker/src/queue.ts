import { Queue } from "bullmq";
import type { SendDmJob, EnqueueSend } from "./types";

export const QUEUE_NAME = "standup";

/** BullMQ connection options derived from REDIS_URL. */
export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return { url };
}

export function createQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: redisConnection() });
}

/** An EnqueueSend backed by a real BullMQ queue. */
export function makeEnqueueSend(queue: Queue): EnqueueSend {
  return async (job: SendDmJob, opts: { delayMs: number }) => {
    await queue.add("send-dm", job, {
      delay: opts.delayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  };
}

/** Enqueue an open-run job to fire immediately (used by trigger + scheduler tick). */
export async function enqueueOpenRun(queue: Queue, standupId: string): Promise<void> {
  await queue.add("open-run", { standupId }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
