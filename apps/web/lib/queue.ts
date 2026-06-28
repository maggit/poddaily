import { Queue } from "bullmq";
import { QUEUE_NAME, SEND_DM_JOB, SYNC_DIRECTORY_JOB } from "@poddaily/shared";
import type { SendDmJob } from "@poddaily/shared";

const globalForQueue = globalThis as unknown as { _poddailyQueue?: Queue };

function getQueue(): Queue {
  const q = globalForQueue._poddailyQueue ?? new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
  if (process.env.NODE_ENV !== "production") globalForQueue._poddailyQueue = q;
  return q;
}

/** Enqueue a send-standup-dm job (immediate). Matches the worker's makeEnqueueSend opts. */
export async function enqueueSendDm(job: SendDmJob): Promise<void> {
  await getQueue().add(SEND_DM_JOB, job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}

/** Enqueue an on-demand workspace directory resync (the worker also runs it on a schedule). */
export async function enqueueDirectorySync(): Promise<void> {
  await getQueue().add(SYNC_DIRECTORY_JOB, {}, { removeOnComplete: true, removeOnFail: false });
}
