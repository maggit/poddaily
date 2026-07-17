/** The single BullMQ queue name shared by the worker (consumer) and the api (producer). */
export const QUEUE_NAME = "standup";

/** Payload for a `retrigger` job — re-start one member's standup for today. */
export interface RetriggerJob {
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
  channel: string; // the DM channel to ack into (unused by the worker, carried for completeness)
}

/** BullMQ job name for opening a standup's daily run (scheduler tick or manual trigger). */
export const OPEN_RUN_JOB = "open-run";

/** Payload for an open-run job. `force` = manual trigger: bypass the weekday guard,
 * DM everyone immediately (no per-member delay), and fan out again on an
 * already-open run so members without a report still get their DM. */
export interface OpenRunJob {
  standupId: string;
  force?: boolean;
}

/** Re-sync repeatable open-run schedulers with the standups table. The web app enqueues
 * this after any standup create/update/pause/resume so schedule changes take effect
 * without a worker restart; the worker also runs it periodically as a safety net. */
export const RECONCILE_JOB = "reconcile-schedules";
export const RECONCILE_SCHEDULER_ID = "reconcile-schedules";
export const RECONCILE_EVERY_MS = 15 * 60 * 1000; // every 15 minutes

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
