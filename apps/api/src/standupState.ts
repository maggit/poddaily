import { schema, eq, and } from "@poddaily/db";
import { anchorDate } from "@poddaily/shared";
import type { Question, ReportAnswer } from "@poddaily/shared";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export type MemberDayStateKind =
  | "not_member" | "no_standup" | "completed" | "in_progress" | "pending" | "paused";

export interface MemberDayState {
  kind: MemberDayStateKind;
  member?: { teamId: string; slackDisplayName: string };
  standup?: { id: string; scheduleTz: string };
  answered: number;
  total: number;
}

/**
 * Classify a member's standup state for "today" (the run's tz-anchored date). Shared by the
 * /standup slash command and the DM-keyword retrigger so both front doors agree.
 */
export async function getMemberDayState(
  db: Db,
  slackUserId: string,
  now: Date = new Date(),
): Promise<MemberDayState> {
  const [member] = await db
    .select({ teamId: schema.teamMembers.teamId, slackDisplayName: schema.teamMembers.slackDisplayName })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.slackUserId, slackUserId))
    .limit(1);
  if (!member?.teamId) return { kind: "not_member", answered: 0, total: 0 };

  const [standup] = await db
    .select({ id: schema.standups.id, scheduleTz: schema.standups.scheduleTz, questions: schema.standups.questions, isActive: schema.standups.isActive })
    .from(schema.standups)
    .where(eq(schema.standups.teamId, member.teamId));
  if (!standup) {
    return { kind: "no_standup", member: { teamId: member.teamId, slackDisplayName: member.slackDisplayName }, answered: 0, total: 0 };
  }

  const total = (standup.questions as Question[]).length;
  const base = {
    member: { teamId: member.teamId, slackDisplayName: member.slackDisplayName },
    standup: { id: standup.id, scheduleTz: standup.scheduleTz },
    total,
  };

  // A paused standup (is_active = false) can't be started — the worker drops the retrigger.
  // Surface it honestly so the user isn't told to "check your DMs" for a DM that never comes.
  if (standup.isActive === false) return { ...base, kind: "paused", answered: 0 };

  const todayDate = anchorDate(standup.scheduleTz, now);
  const [todayRun] = await db
    .select({ id: schema.standupRuns.id })
    .from(schema.standupRuns)
    .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, todayDate)));
  if (!todayRun) return { ...base, kind: "pending", answered: 0 };

  const [report] = await db
    .select({ status: schema.standupReports.status, answers: schema.standupReports.answers })
    .from(schema.standupReports)
    .where(and(eq(schema.standupReports.runId, todayRun.id), eq(schema.standupReports.slackUserId, slackUserId)));

  if (report?.status === "completed") return { ...base, kind: "completed", answered: total };
  if (report?.status === "in_progress") {
    return { ...base, kind: "in_progress", answered: (report.answers as ReportAnswer[]).length };
  }
  return { ...base, kind: "pending", answered: 0 };
}
