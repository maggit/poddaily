import { eq, and, ne } from "drizzle-orm";
import * as schema from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

const TERMINAL = new Set(["completed", "timed_out"]);

/**
 * Mark a run `completed` once every report for it is terminal (completed | timed_out).
 * Returns whether this call performed the completion. Idempotent + concurrency-safe:
 * the early return plus the `status != 'completed'` guard mean overlapping callers
 * (the timeout handler and the api completing the last report) converge to one completion.
 */
export async function finalizeRunIfDone(db: Db, runId: string): Promise<boolean> {
  const [run] = await db
    .select({ status: schema.standupRuns.status })
    .from(schema.standupRuns)
    .where(eq(schema.standupRuns.id, runId));
  if (!run || run.status === "completed") return false;

  const reports = await db
    .select({ status: schema.standupReports.status })
    .from(schema.standupReports)
    .where(eq(schema.standupReports.runId, runId));
  if (!reports.every((r) => r.status !== null && TERMINAL.has(r.status))) return false;

  const updated = await db
    .update(schema.standupRuns)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(schema.standupRuns.id, runId), ne(schema.standupRuns.status, "completed")))
    .returning({ id: schema.standupRuns.id });
  return updated.length > 0;
}
