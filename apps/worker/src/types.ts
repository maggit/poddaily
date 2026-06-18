import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

export type Db = ReturnType<typeof createDb>["db"];

/** Payload for a per-member send-standup-dm job. */
export interface SendDmJob {
  runId: string;
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
}

/** Enqueue a send-standup-dm job, delayed `delayMs` from now (0 = immediate). */
export type EnqueueSend = (job: SendDmJob, opts: { delayMs: number }) => Promise<void>;

export interface OpenRunDeps {
  db: Db;
  enqueueSend: EnqueueSend;
}

export interface SendDmDeps {
  db: Db;
  slack: SlackClient;
}
