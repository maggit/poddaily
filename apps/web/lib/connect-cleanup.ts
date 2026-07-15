import { schema, eq, and, desc, isNotNull, lastReportDateBefore, listMemberLinearClosed, type createDb } from "@poddaily/db";
import { buildReportBlocks, buildConnectedFooter, interpolateLastReportDate } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";

type Db = ReturnType<typeof createDb>["db"];

/**
 * After a member connects, swap the "hasn't connected — Connect to post as yourself"
 * footer on their MOST RECENT bot-posted channel report for a "✅ connected" note, so
 * the stale nudge doesn't read as a failed connection. chat.update needs the full block
 * list, so the report body is rebuilt from the stored answers — deterministic because
 * the last-report-date and Linear windows are anchored to the report's own timestamps.
 * Best-effort by contract: the caller must never fail the connect flow over this.
 */
export async function refreshLatestBotReport(db: Db, slack: SlackClient, slackUserId: string): Promise<boolean> {
  const [report] = await db
    .select()
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.slackUserId, slackUserId),
      eq(schema.standupReports.postedAs, "bot"),
      isNotNull(schema.standupReports.channelPostTs),
    ))
    .orderBy(desc(schema.standupReports.reportedAt))
    .limit(1);
  if (!report?.runId || !report.channelPostTs) return false;

  const [run] = await db.select().from(schema.standupRuns).where(eq(schema.standupRuns.id, report.runId));
  if (!run?.standupId) return false;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, run.standupId));
  if (!standup?.teamId) return false;
  const [team] = await db
    .select({ channelId: schema.teams.slackChannelId })
    .from(schema.teams)
    .where(eq(schema.teams.id, standup.teamId));
  if (!team?.channelId) return false;

  // Same inputs broadcastReport used when it posted, re-derived from the report's own
  // timestamps so the rebuilt body matches the original.
  const lastDate = await lastReportDateBefore(db, slackUserId, report.createdAt ?? new Date());
  const to = report.reportedAt ?? new Date();
  const from = lastDate ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  let linearIssues: { identifier: string | null; title: string | null; url: string | null }[] = [];
  try {
    linearIssues = (await listMemberLinearClosed(db, slackUserId, from, to))
      .map((i) => ({ identifier: i.identifier, title: i.title, url: i.url }));
  } catch {
    // Body still rebuilds without the Linear section — matches a broadcast-time miss.
  }
  const built = buildReportBlocks({
    standupName: standup.name,
    displayName: report.slackDisplayName,
    answers: report.answers.map((a) => ({ ...a, questionText: interpolateLastReportDate(a.questionText, lastDate) })),
    linearIssues,
  });

  await slack.updateMessage(team.channelId, report.channelPostTs, {
    text: built.text,
    blocks: [...(built.blocks as unknown[]), buildConnectedFooter(report.slackDisplayName)],
  });
  return true;
}
