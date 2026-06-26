import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";
import type { SendDmJob, ReminderJob } from "@poddaily/shared";

export type Db = ReturnType<typeof createDb>["db"];

export type { SendDmJob, ReminderJob };

/** Enqueue a send-standup-dm job, delayed `delayMs` from now (0 = immediate). */
export type EnqueueSend = (job: SendDmJob, opts: { delayMs: number }) => Promise<void>;

/** Payload for a per-report timeout-report job (fires `delayMs` after the DM started). */
export interface TimeoutJob {
  runId: string;
  slackUserId: string;
}

/** Enqueue a timeout-report job, delayed `delayMs` from now. */
export type EnqueueTimeout = (job: TimeoutJob, opts: { delayMs: number }) => Promise<void>;

/** Enqueue the reminder series for a report (every intervalMs, strictly < timeoutMs). */
export type EnqueueReminders = (job: ReminderJob, opts: { intervalMs: number; timeoutMs: number }) => Promise<void>;

export interface OpenRunDeps {
  db: Db;
  enqueueSend: EnqueueSend;
  slack: SlackClient;
}

export interface SendDmDeps {
  db: Db;
  slack: SlackClient;
  enqueueTimeout: EnqueueTimeout;
  enqueueReminders: EnqueueReminders;
}
