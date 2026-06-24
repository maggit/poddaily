import { schema, eq, lastReportDateBefore } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import type { RetriggerJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import { ensureRunOpen } from "./openRun";
import type { Db, EnqueueTimeout } from "./types";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface RetriggerDeps {
  db: Db;
  slack: SlackClient;
  enqueueTimeout: EnqueueTimeout;
}

/**
 * Re-start one member's standup for today: ensure the run is open, reset/create their report
 * to a fresh in_progress, re-send intro + Q1, set the run back to running, and schedule a new
 * timeout. Self-contained posting (doesn't touch the live sendDm path). Idempotent on retry.
 */
export async function retrigger(deps: RetriggerDeps, job: RetriggerJob): Promise<void> {
  const { db, slack, enqueueTimeout } = deps;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, job.standupId));
  if (!standup || !standup.isActive || !standup.teamId) return;
  const firstQuestion = standup.questions[0];
  if (!firstQuestion) return;

  const { run } = await ensureRunOpen({ db, slack }, standup, new Date());

  const lastDate = await lastReportDateBefore(db, job.slackUserId, new Date());
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
}
