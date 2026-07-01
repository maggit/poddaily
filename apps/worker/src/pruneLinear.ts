import { pruneLinearActivity } from "@poddaily/db";
import { LINEAR_ACTIVITY_RETENTION_DAYS } from "@poddaily/shared";
import type { Db } from "./types";

/** Delete Linear activity older than the retention window. Idempotent; safe to run daily. */
export async function pruneLinear(deps: { db: Db }): Promise<number> {
  const cutoff = new Date(Date.now() - LINEAR_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const removed = await pruneLinearActivity(deps.db, cutoff);
  console.log(`[prune-linear] removed ${removed} rows older than ${LINEAR_ACTIVITY_RETENTION_DAYS}d`);
  return removed;
}
