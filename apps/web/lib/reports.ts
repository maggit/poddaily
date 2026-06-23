import { eq, and, desc, lastReportDateBefore, schema } from "@poddaily/db";
import { interpolateLastReportDate } from "@poddaily/shared";
import { db, sql } from "./db";

export interface OverviewRow {
  teamId: string; teamName: string; slackChannelName: string; standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  reported: number; total: number;
}

/** One row per active standup: today's run (scheduled_date = current_date) + participation. */
export async function getTodayOverview(): Promise<OverviewRow[]> {
  const rows = await sql<Array<{
    team_id: string; team_name: string; slack_channel_name: string; standup_name: string;
    run_id: string | null; run_date: string | null; run_status: string | null;
    total: number; reported: number;
  }>>`
    select s.team_id, t.name as team_name, t.slack_channel_name, s.name as standup_name,
           r.id as run_id, r.scheduled_date::text as run_date, r.status as run_status,
           count(rep.id)::int as total,
           count(rep.id) filter (where rep.status = 'completed')::int as reported
    from standups s
    join teams t on t.id = s.team_id
    left join standup_runs r on r.standup_id = s.id and r.scheduled_date = current_date
    left join standup_reports rep on rep.run_id = r.id
    where s.is_active = true
    group by s.team_id, t.name, t.slack_channel_name, s.name, r.id, r.scheduled_date, r.status
    order by t.name`;
  return rows.map((x) => ({
    teamId: x.team_id, teamName: x.team_name, slackChannelName: x.slack_channel_name, standupName: x.standup_name,
    run: x.run_id ? { id: x.run_id, scheduledDate: x.run_date as string, status: x.run_status ?? "running" } : null,
    reported: x.reported, total: x.total,
  }));
}

export interface ReportCard {
  slackUserId: string; displayName: string; avatarUrl: string | null;
  status: "completed" | "in_progress" | "timed_out" | "absent";
  answers: { question: string; answer: string }[];
  reportedAt: Date | null;
}
export interface RunDetail {
  team: { id: string; name: string; slackChannelName: string };
  standupName: string;
  run: { id: string; scheduledDate: string; status: string } | null;
  cards: ReportCard[]; reported: number; total: number;
}

/** A team's run for `date` (default = latest), with each can_report member's card. Null = unknown team. */
export async function getRunDetail(teamId: string, date?: string): Promise<RunDetail | null> {
  const [teamRows, standupRows, members] = await Promise.all([
    db.select().from(schema.teams).where(eq(schema.teams.id, teamId)),
    db.select().from(schema.standups).where(eq(schema.standups.teamId, teamId)),
    db.select().from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.canReport, true)))
      .orderBy(schema.teamMembers.slackDisplayName),
  ]);
  const team = teamRows[0];
  const standup = standupRows[0];
  if (!team) return null;

  let run: typeof schema.standupRuns.$inferSelect | undefined;
  if (standup) {
    const where = date
      ? and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, date))
      : eq(schema.standupRuns.standupId, standup.id);
    [run] = await db.select().from(schema.standupRuns).where(where).orderBy(desc(schema.standupRuns.scheduledDate)).limit(1);
  }

  const reports = run
    ? await db.select().from(schema.standupReports).where(eq(schema.standupReports.runId, run.id))
    : [];
  const byUser = new Map(reports.map((r) => [r.slackUserId, r]));

  const cards: ReportCard[] = await Promise.all(members.map(async (m) => {
    const rep = byUser.get(m.slackUserId);
    if (!rep) {
      return { slackUserId: m.slackUserId, displayName: m.slackDisplayName, avatarUrl: m.slackAvatarUrl, status: "absent", answers: [], reportedAt: null };
    }
    let answers: { question: string; answer: string }[] = [];
    if (rep.status === "completed") {
      const lastDate = await lastReportDateBefore(db, m.slackUserId, rep.createdAt ?? new Date());
      answers = rep.answers.map((a) => ({ question: interpolateLastReportDate(a.questionText, lastDate), answer: a.answer }));
    }
    return {
      slackUserId: m.slackUserId, displayName: m.slackDisplayName, avatarUrl: m.slackAvatarUrl,
      status: (rep.status ?? "in_progress") as ReportCard["status"], answers, reportedAt: rep.reportedAt,
    };
  }));

  return {
    team: { id: team.id, name: team.name, slackChannelName: team.slackChannelName },
    standupName: standup?.name ?? "Standup",
    run: run ? { id: run.id, scheduledDate: run.scheduledDate, status: run.status ?? "running" } : null,
    cards,
    total: reports.length,
    reported: reports.filter((r) => r.status === "completed").length,
  };
}

export interface RunDate { date: string; status: string; reported: number; total: number; }

export async function listTeamRunDates(teamId: string, limit = 14): Promise<RunDate[]> {
  const rows = await sql<Array<{ date: string; status: string | null; total: number; reported: number }>>`
    select r.scheduled_date::text as date, r.status,
           count(rep.id)::int as total,
           count(rep.id) filter (where rep.status = 'completed')::int as reported
    from standups s
    join standup_runs r on r.standup_id = s.id
    left join standup_reports rep on rep.run_id = r.id
    where s.team_id = ${teamId}
    group by r.id, r.scheduled_date, r.status
    order by r.scheduled_date desc
    limit ${limit}`;
  return rows.map((r) => ({ date: r.date, status: r.status ?? "running", reported: r.reported, total: r.total }));
}
