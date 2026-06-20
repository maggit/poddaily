import { schema, eq, and } from "@poddaily/db";
import { anchorDate, isActiveWeekday, computeSendInstant, buildOpeningMessage } from "@poddaily/shared";
import type { OpenRunDeps } from "./types";

export interface OpenRunResult {
  runId: string | null;
  enqueued: number;
}

/**
 * Open today's run for a standup and fan out a send-standup-dm job per reporting
 * member. Idempotent: the unique (standup_id, scheduled_date) constraint means a
 * second call for the same day inserts no run and fans out nothing.
 */
export async function openRun(deps: OpenRunDeps, standupId: string, now: Date): Promise<OpenRunResult> {
  const { db, enqueueSend, slack } = deps;

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup || !standup.isActive) return { runId: null, enqueued: 0 };
  // teamId is nullable in the schema; without it the member query would match
  // nothing and silently open a run with zero sends — guard explicitly.
  if (!standup.teamId) return { runId: null, enqueued: 0 };
  if (!isActiveWeekday(standup.scheduleCron, standup.scheduleTz, now)) return { runId: null, enqueued: 0 };

  const date = anchorDate(standup.scheduleTz, now);

  // Insert the run; on conflict (already opened today) do nothing and bail out.
  const inserted = await db
    .insert(schema.standupRuns)
    .values({ standupId, scheduledAt: now, scheduledDate: date, status: "running", startedAt: now })
    .onConflictDoNothing({ target: [schema.standupRuns.standupId, schema.standupRuns.scheduledDate] })
    .returning();
  if (inserted.length === 0) return { runId: null, enqueued: 0 };
  const runId = inserted[0].id;

  const members = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.canReport, true)));

  // Post the channel opening message once per run (best-effort) and store its ts for
  // threading. teamId is non-null here (guarded above). Per-report replies are threaded
  // under this ts by the api on completion.
  try {
    const [team] = await db
      .select({ channelId: schema.teams.slackChannelId })
      .from(schema.teams)
      .where(eq(schema.teams.id, standup.teamId));
    if (team?.channelId) {
      const opening = buildOpeningMessage({
        standupName: standup.name,
        date,
        reported: 0,
        total: members.length,
      });
      const openingTs = await slack.postMessage(team.channelId, opening.text, { blocks: opening.blocks });
      await db
        .update(schema.standupRuns)
        .set({ channelOpeningTs: openingTs })
        .where(eq(schema.standupRuns.id, runId));
    }
  } catch (err) {
    console.warn(`[broadcast] opening message failed for run ${runId}:`, (err as Error).message);
  }

  // At-least-once fan-out: the run row is committed before this loop, so if an
  // enqueue throws partway (e.g. Redis down) the run is left in "running" and the
  // remaining members aren't enqueued. Recovery (complete-run + timeout sweeper)
  // is Step 7; send-standup-dm itself is idempotent on (run_id, slack_user_id).
  for (const m of members) {
    const tz = m.timezone ?? standup.scheduleTz;
    const sendAt = computeSendInstant(standup.scheduleCron, tz, date);
    const delayMs = Math.max(0, sendAt.getTime() - now.getTime());
    await enqueueSend(
      { runId, standupId, slackUserId: m.slackUserId, slackDisplayName: m.slackDisplayName },
      { delayMs },
    );
  }

  return { runId, enqueued: members.length };
}
