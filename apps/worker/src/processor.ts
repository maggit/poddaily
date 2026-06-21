import type { Job, Queue } from "bullmq";
import type { SlackClient } from "@poddaily/slack-client";
import { makeEnqueueSend, makeEnqueueTimeout } from "./queue";
import { openRun } from "./openRun";
import { sendDm } from "./sendDm";
import { timeoutReport } from "./timeoutReport";
import type { Db, SendDmJob, TimeoutJob } from "./types";

export interface ProcessorDeps {
  db: Db;
  slack: SlackClient;
  queue: Queue;
}

/**
 * The BullMQ job processor: routes a job to openRun or sendDm by name. Shared by
 * the worker boot (index.ts) and the end-to-end smoke so both exercise the same
 * dispatch — including the unknown-job guard.
 */
export function createProcessor(deps: ProcessorDeps): (job: Job) => Promise<void> {
  const { db, slack, queue } = deps;
  const enqueueSend = makeEnqueueSend(queue);
  const enqueueTimeout = makeEnqueueTimeout(queue);
  return async (job: Job): Promise<void> => {
    if (job.name === "open-run") {
      const { standupId } = job.data as { standupId: string };
      await openRun({ db, enqueueSend, slack }, standupId, new Date());
    } else if (job.name === "send-dm") {
      await sendDm({ db, slack, enqueueTimeout }, job.data as SendDmJob);
    } else if (job.name === "timeout-report") {
      await timeoutReport({ db }, job.data as TimeoutJob);
    } else {
      throw new Error(`[worker] unknown job name: ${job.name}`);
    }
  };
}
