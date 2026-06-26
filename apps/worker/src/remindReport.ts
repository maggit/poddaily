import { schema, eq, and } from "@poddaily/db";
import type { ReminderJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { Db } from "./types";

export interface RemindReportDeps {
  db: Db;
  slack: SlackClient;
}

/**
 * Nudge a member who hasn't finished today's run. No-op if their report is no longer
 * in_progress (already completed / timed out). Records a standup_reminders row (best-effort).
 */
export async function remindReport(deps: RemindReportDeps, job: ReminderJob): Promise<void> {
  const { db, slack } = deps;

  const [report] = await db
    .select({ status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, job.runId), eq(schema.standupReports.slackUserId, job.slackUserId)));
  if (!report || report.status !== "in_progress") return;

  let standupName = "standup";
  const [run] = await db.select({ standupId: schema.standupRuns.standupId }).from(schema.standupRuns).where(eq(schema.standupRuns.id, job.runId));
  if (run?.standupId) {
    const [s] = await db.select({ name: schema.standups.name }).from(schema.standups).where(eq(schema.standups.id, run.standupId));
    if (s?.name) standupName = s.name;
  }

  const channelId = await slack.openDm(job.slackUserId);
  await slack.postMessage(channelId, `👋 Reminder — you haven't finished today's *${standupName}* yet. Just reply here to pick up where you left off.`);

  try {
    await db.insert(schema.standupReminders).values({ runId: job.runId, slackUserId: job.slackUserId, type: "reminder" });
  } catch (err) {
    console.warn(`[reminder] could not record reminder for ${job.slackUserId}:`, (err as Error).message);
  }
}
