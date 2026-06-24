import { schema, eq, and, lastReportDateBefore } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import type { RetriggerJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import { ensureRunOpen, fanOutSends } from "./openRun";
import type { Db, EnqueueSend, EnqueueTimeout } from "./types";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface RetriggerDeps {
  db: Db;
  slack: SlackClient;
  enqueueSend: EnqueueSend;
  enqueueTimeout: EnqueueTimeout;
}

/**
 * Re-start one member's standup for today: ensure the run is open, reset/create their report
 * to a fresh in_progress, re-send intro + Q1, set the run back to running, and schedule a new
 * timeout. Self-contained posting (doesn't touch the live sendDm path).
 *
 * - Retry-safe: a delayed BullMQ retry won't clobber a report the member has already started or
 *   finished (we only (re)open an absent or timed_out report).
 * - Team recovery: if WE had to open today's run (the scheduler never did — it was down, or the
 *   keyword arrived before the scheduled tick), fan out the standard send to the rest of the
 *   team so they aren't left without a standup. When the run already existed, stay self-scoped.
 */
export async function retrigger(deps: RetriggerDeps, job: RetriggerJob): Promise<void> {
  const { db, slack, enqueueSend, enqueueTimeout } = deps;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, job.standupId));
  if (!standup || !standup.isActive || !standup.teamId) return;
  const firstQuestion = standup.questions[0];
  if (!firstQuestion) return;

  const now = new Date();
  const { run, created } = await ensureRunOpen({ db, slack }, standup, now);

  // Only (re)open an absent or timed_out report. An in_progress/completed row means the member
  // is mid-conversation or already done — leave it untouched (guards delayed-retry wipes).
  const [existing] = await db
    .select({ status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, run.id), eq(schema.standupReports.slackUserId, job.slackUserId)));
  if (existing && existing.status !== "timed_out") return;

  const lastDate = await lastReportDateBefore(db, job.slackUserId, now);
  const q1Text = interpolateLastReportDate(firstQuestion.text, lastDate);

  const channelId = await slack.openDm(job.slackUserId);
  let firstTs: string | null = null;
  if (standup.introMessage) firstTs = await slack.postMessage(channelId, standup.introMessage);
  const q1Ts = await slack.postMessage(channelId, q1Text);

  await db
    .insert(schema.standupReports)
    .values({ runId: run.id, slackUserId: job.slackUserId, slackDisplayName: job.slackDisplayName, answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts })
    .onConflictDoUpdate({
      target: [schema.standupReports.runId, schema.standupReports.slackUserId],
      set: { answers: [], status: "in_progress", dmThreadTs: firstTs ?? q1Ts, reportedAt: null },
    });

  // The run may have been completed by the timeout sweeper — re-open it.
  await db.update(schema.standupRuns).set({ status: "running" }).where(eq(schema.standupRuns.id, run.id));

  const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);
  await enqueueTimeout({ runId: run.id, slackUserId: job.slackUserId }, { delayMs: timeoutMs });

  // If we had to open the run ourselves, the scheduler never fanned out — recover the team
  // (the requester is excluded; they got the direct re-DM above). sendDm is idempotent.
  if (created) {
    await fanOutSends({ db, enqueueSend }, standup, run, now, { excludeUserId: job.slackUserId });
  }
}
