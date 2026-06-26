import { schema, eq, and, finalizeRunIfDone } from "@poddaily/db";
import type { Db, TimeoutJob, EnqueueTimeout } from "./types";

export interface TimeoutReportDeps {
  db: Db;
  enqueueTimeout: EnqueueTimeout;
}

/**
 * Time out a member's report if it's still in_progress AND its (inactivity) deadline has
 * passed. If the member has replied since this job was enqueued, `timeout_at` has moved into
 * the future — re-enqueue this job for the new deadline instead of timing out. No-op if the
 * report already finished/aborted. A null `timeout_at` (legacy row) times out immediately.
 */
export async function timeoutReport(deps: TimeoutReportDeps, job: TimeoutJob): Promise<void> {
  const { db, enqueueTimeout } = deps;
  const [report] = await db
    .select({ id: schema.standupReports.id, status: schema.standupReports.status, timeoutAt: schema.standupReports.timeoutAt })
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.runId, job.runId),
      eq(schema.standupReports.slackUserId, job.slackUserId),
    ));
  if (!report || report.status !== "in_progress") return;

  if (report.timeoutAt) {
    const remainingMs = report.timeoutAt.getTime() - Date.now();
    if (remainingMs > 0) {
      await enqueueTimeout({ runId: job.runId, slackUserId: job.slackUserId }, { delayMs: remainingMs });
      return;
    }
  }

  await db
    .update(schema.standupReports)
    .set({ status: "timed_out" })
    .where(eq(schema.standupReports.id, report.id));

  await finalizeRunIfDone(db, job.runId);
}
