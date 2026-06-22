import { eq, and, lt, desc } from "drizzle-orm";
import * as schema from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

/**
 * The member's most recent COMPLETED report strictly before `before` — i.e. their previous
 * standup — for interpolating {last_report_date}. Null if they have no prior completed report.
 */
export async function lastReportDateBefore(db: Db, slackUserId: string, before: Date): Promise<Date | null> {
  const [row] = await db
    .select({ reportedAt: schema.standupReports.reportedAt })
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.slackUserId, slackUserId),
      eq(schema.standupReports.status, "completed"),
      lt(schema.standupReports.reportedAt, before),
    ))
    .orderBy(desc(schema.standupReports.reportedAt))
    .limit(1);
  return row?.reportedAt ?? null;
}
