import { eq, and, schema } from "@poddaily/db";
import { anchorDate } from "@poddaily/shared";
import type { SendDmJob } from "@poddaily/shared";
import { db } from "./db";
import { getStandup } from "./standups";
import { enqueueSendDm } from "./queue";

/**
 * If a member is a reporter and today's run for their team's active standup is already open
 * (and they have no report yet), enqueue a send-standup-dm so they get today's standup now.
 * `enqueue` is injectable for tests. Guards short-circuit on the first failure.
 */
export async function enqueueLateJoinIfOpen(
  memberId: string,
  enqueue: (job: SendDmJob) => Promise<void> = enqueueSendDm,
): Promise<void> {
  const [member] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, memberId));
  if (!member || !member.canReport || !member.teamId) return;

  const standup = await getStandup(member.teamId);
  if (!standup || standup.isActive === false) return; // missing or paused

  const todayDate = anchorDate(standup.scheduleTz, new Date());
  const [run] = await db
    .select({ id: schema.standupRuns.id })
    .from(schema.standupRuns)
    .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, todayDate)));
  if (!run) return; // no run open today — normal fan-out / next scheduled day handles it

  const [existing] = await db
    .select({ id: schema.standupReports.id })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, run.id), eq(schema.standupReports.slackUserId, member.slackUserId)));
  if (existing) return; // already got it / already reported

  await enqueue({ runId: run.id, standupId: standup.id, slackUserId: member.slackUserId, slackDisplayName: member.slackDisplayName });
}
