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

/** Payload for a reminder job — nudge a member who hasn't finished today's run. */
export interface ReminderJob {
  runId: string;
  slackUserId: string;
}
