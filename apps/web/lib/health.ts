import { anchorDate, computeSendInstant, isActiveWeekday, nextRunInstant } from "@poddaily/shared";
import { sql } from "./db";

/** The health verdict for one team's standup, derived server-side from the latest run. */
export type HealthState =
  | "unconfigured" // team has no standup yet
  | "paused"
  | "completed" // today's run finished
  | "running" // today's run is open, waiting on reports
  | "missed" // today was a scheduled day, the send time passed, and no run opened
  | "waiting"; // nothing due yet — next run is in the future

export interface StandupHealthRow {
  teamId: string;
  teamName: string;
  slackChannelName: string;
  standupId: string | null;
  standupName: string | null;
  isActive: boolean;
  scheduleCron: string | null;
  scheduleTz: string | null;
  state: HealthState;
  /** Latest run (any date), if one ever opened. */
  lastRun: {
    date: string;
    status: string;
    isToday: boolean;
    dmSent: number; // report rows = DMs actually delivered
    completed: number;
    inProgress: number;
    timedOut: number;
  } | null;
  /** Members with can_report — the expected DM count for a run. */
  reporters: number;
  nextRunAt: Date | null;
}

/**
 * One row per team: latest run + per-status report counts + the derived health state.
 * "missed" is the row to watch — it means the scheduler never opened a run on a day it
 * should have (the exact failure mode of a standup created after the worker booted).
 */
export async function getStandupHealth(now = new Date()): Promise<StandupHealthRow[]> {
  const rows = await sql<Array<{
    team_id: string; team_name: string; slack_channel_name: string;
    standup_id: string | null; standup_name: string | null; is_active: boolean | null;
    schedule_cron: string | null; schedule_tz: string | null; reporters: number;
    run_date: string | null; run_status: string | null;
    dm_sent: number; completed: number; in_progress: number; timed_out: number;
  }>>`
    select t.id as team_id, t.name as team_name, t.slack_channel_name,
           s.id as standup_id, s.name as standup_name, s.is_active, s.schedule_cron, s.schedule_tz,
           (select count(*)::int from team_members tm where tm.team_id = t.id and tm.can_report = true) as reporters,
           r.scheduled_date::text as run_date, r.status as run_status,
           coalesce(rc.dm_sent, 0) as dm_sent,
           coalesce(rc.completed, 0) as completed,
           coalesce(rc.in_progress, 0) as in_progress,
           coalesce(rc.timed_out, 0) as timed_out
    from teams t
    left join standups s on s.team_id = t.id
    left join lateral (
      select sr.id, sr.scheduled_date, sr.status
      from standup_runs sr where sr.standup_id = s.id
      order by sr.scheduled_date desc limit 1
    ) r on true
    left join lateral (
      select count(*)::int as dm_sent,
             count(*) filter (where rep.status = 'completed')::int as completed,
             count(*) filter (where rep.status = 'in_progress')::int as in_progress,
             count(*) filter (where rep.status = 'timed_out')::int as timed_out
      from standup_reports rep where rep.run_id = r.id
    ) rc on true
    order by t.name`;

  return rows.map((x) => {
    let state: HealthState;
    let nextRunAt: Date | null = null;
    let isToday = false;

    if (!x.standup_id || !x.schedule_cron || !x.schedule_tz) {
      state = "unconfigured";
    } else if (x.is_active === false) {
      state = "paused";
    } else {
      try {
        const today = anchorDate(x.schedule_tz, now);
        isToday = x.run_date === today;
        nextRunAt = nextRunInstant(x.schedule_cron, x.schedule_tz, now);
        if (isToday) {
          state = x.run_status === "completed" ? "completed" : "running";
        } else if (
          isActiveWeekday(x.schedule_cron, x.schedule_tz, now) &&
          now >= computeSendInstant(x.schedule_cron, x.schedule_tz, today)
        ) {
          state = "missed";
        } else {
          state = "waiting";
        }
      } catch {
        // Unparseable cron — surface as missed so someone looks at it rather than hiding it.
        state = "missed";
      }
    }

    return {
      teamId: x.team_id,
      teamName: x.team_name,
      slackChannelName: x.slack_channel_name,
      standupId: x.standup_id,
      standupName: x.standup_name,
      isActive: x.is_active !== false,
      scheduleCron: x.schedule_cron,
      scheduleTz: x.schedule_tz,
      state,
      lastRun: x.run_date
        ? {
            date: x.run_date,
            status: x.run_status ?? "running",
            isToday,
            dmSent: x.dm_sent,
            completed: x.completed,
            inProgress: x.in_progress,
            timedOut: x.timed_out,
          }
        : null,
      reporters: x.reporters,
      nextRunAt,
    };
  });
}
