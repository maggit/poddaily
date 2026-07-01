/** The single BullMQ queue name shared by the worker (consumer) and the api (producer). */
export const QUEUE_NAME = "standup";

/** Payload for a `retrigger` job — re-start one member's standup for today. */
export interface RetriggerJob {
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
  channel: string; // the DM channel to ack into (unused by the worker, carried for completeness)
}

/** BullMQ job name for a per-member send-standup-dm job. */
export const SEND_DM_JOB = "send-dm";

/** Payload for a per-member send-standup-dm job. */
export interface SendDmJob {
  runId: string;
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
}

/** BullMQ job name for a reminder nudge. */
export const REMINDER_JOB = "reminder";

/** BullMQ job name for the workspace directory sync (users.list → slack_directory_users). */
export const SYNC_DIRECTORY_JOB = "sync-directory";

/** Repeatable-scheduler id + cadence for the directory sync. */
export const DIRECTORY_SYNC_SCHEDULER_ID = "directory-sync";
export const DIRECTORY_SYNC_EVERY_MS = 6 * 60 * 60 * 1000; // every 6 hours

/** Prune old Linear activity rows (we only surface recent completions). */
export const PRUNE_LINEAR_JOB = "prune-linear-activity";
export const PRUNE_LINEAR_SCHEDULER_ID = "prune-linear-activity";
export const PRUNE_LINEAR_EVERY_MS = 24 * 60 * 60 * 1000; // daily
export const LINEAR_ACTIVITY_RETENTION_DAYS = 45;

/** Payload for a reminder job — nudge a member who hasn't finished today's run. */
export interface ReminderJob {
  runId: string;
  slackUserId: string;
}
