/** The single BullMQ queue name shared by the worker (consumer) and the api (producer). */
export const QUEUE_NAME = "standup";

/** Payload for a `retrigger` job — re-start one member's standup for today. */
export interface RetriggerJob {
  standupId: string;
  slackUserId: string;
  slackDisplayName: string;
  channel: string; // the DM channel to ack into (unused by the worker, carried for completeness)
}
