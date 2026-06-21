import { schema, eq, and, finalizeRunIfDone } from "@poddaily/db";
import type { Db, TimeoutJob } from "./types";

export interface TimeoutReportDeps {
  db: Db;
}

/**
 * Time out a member's report if it's still in_progress when this job fires (the job's
 * delay encodes the 4h, so firing == 4h elapsed — no clock recheck needed). No-op if the
 * member already finished (completed) or aborted (timed_out via `skip all`). Then finalize
 * the run, which closes it once every report is terminal.
 */
export async function timeoutReport(deps: TimeoutReportDeps, job: TimeoutJob): Promise<void> {
  const { db } = deps;
  const [report] = await db
    .select({ id: schema.standupReports.id, status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.runId, job.runId),
      eq(schema.standupReports.slackUserId, job.slackUserId),
    ));
  if (!report || report.status !== "in_progress") return;

  await db
    .update(schema.standupReports)
    .set({ status: "timed_out" })
    .where(eq(schema.standupReports.id, report.id));

  await finalizeRunIfDone(db, job.runId);
}
