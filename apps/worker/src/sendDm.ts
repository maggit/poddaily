import { schema, eq, and, desc, hasUserToken } from "@poddaily/db";
import { buildConnectNudgeMessage, interpolateLastReportDate } from "@poddaily/shared";
import type { SendDmDeps, SendDmJob } from "./types";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Open the member's DM, post the intro (if any) + the interpolated first question,
 * and insert the in_progress report. Idempotent: if a report already exists for
 * (runId, slackUserId) we short-circuit before posting, so BullMQ retries never
 * double-DM. The unique (run_id, slack_user_id) constraint is the backstop.
 */
export async function sendDm(deps: SendDmDeps, job: SendDmJob): Promise<void> {
  const { db, slack, enqueueTimeout, enqueueReminders } = deps;
  const { runId, standupId, slackUserId, slackDisplayName } = job;

  const existing = await db
    .select({ id: schema.standupReports.id })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, runId), eq(schema.standupReports.slackUserId, slackUserId)));
  if (existing.length > 0) return; // already sent — retry no-op

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup) throw new Error(`sendDm: standup ${standupId} not found`);
  const firstQuestion = standup.questions[0];
  if (!firstQuestion) throw new Error(`sendDm: standup ${standupId} has no questions`);

  // Most recent completed report for this user → last_report_date.
  const [last] = await db
    .select({ reportedAt: schema.standupReports.reportedAt })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.slackUserId, slackUserId), eq(schema.standupReports.status, "completed")))
    .orderBy(desc(schema.standupReports.reportedAt))
    .limit(1);
  const q1Text = interpolateLastReportDate(firstQuestion.text, last?.reportedAt ?? null);

  // Idempotency boundary: the existence-check above only guards once the report
  // row exists. If a post throws mid-way (before the insert below), a BullMQ retry
  // re-runs from the top and may re-post — acceptable at-least-once for Phase 1.
  const channelId = await slack.openDm(slackUserId);
  let firstTs: string | null = null;
  if (standup.introMessage) {
    firstTs = await slack.postMessage(channelId, standup.introMessage);
  }
  const q1Ts = await slack.postMessage(channelId, q1Text);

  // Nudge unconnected members to connect so their reports post as themselves (Step 6b).
  // Existence check only — the worker never decrypts tokens.
  const webUrl = process.env.NEXTAUTH_URL;
  if (webUrl && !(await hasUserToken(db, slackUserId))) {
    const nudge = buildConnectNudgeMessage(webUrl);
    await slack.postMessage(channelId, nudge.text, { blocks: nudge.blocks });
  }

  // Per-report 4h timeout (Step 7). Read at call time so tests can override. The delay
  // encodes the deadline; the timeout-report handler no-ops if the member finished first.
  const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);

  await db
    .insert(schema.standupReports)
    .values({
      runId,
      slackUserId,
      slackDisplayName,
      answers: [],
      status: "in_progress",
      dmThreadTs: firstTs ?? q1Ts,
      timeoutAt: new Date(Date.now() + timeoutMs),
    })
    .onConflictDoNothing({ target: [schema.standupReports.runId, schema.standupReports.slackUserId] });

  await enqueueTimeout({ runId, slackUserId }, { delayMs: timeoutMs });
  await enqueueReminders(
    { runId, slackUserId },
    { intervalMs: (standup.reminderIntervalMinutes ?? 0) * 60_000, timeoutMs },
  );
}
