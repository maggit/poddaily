import { schema, eq, and } from "@poddaily/db";
import { anchorDate, isActiveWeekday, computeSendInstant, buildOpeningMessage } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { Db, EnqueueSend, OpenRunDeps } from "./types";

export interface OpenRunResult {
  runId: string | null;
  enqueued: number;
}

/**
 * Open today's run for a standup (idempotent on standup_id+scheduled_date), posting the
 * channel opening message on first open, and return the run plus whether THIS call created
 * it. Does NOT fan out to members — callers decide (openRun fans out; retrigger sends to one).
 */
export async function ensureRunOpen(
  deps: { db: Db; slack: SlackClient },
  standup: typeof schema.standups.$inferSelect,
  now: Date,
): Promise<{ run: typeof schema.standupRuns.$inferSelect; created: boolean }> {
  const { db, slack } = deps;
  const date = anchorDate(standup.scheduleTz, now);

  const inserted = await db
    .insert(schema.standupRuns)
    .values({ standupId: standup.id, scheduledAt: now, scheduledDate: date, status: "running", startedAt: now })
    .onConflictDoNothing({ target: [schema.standupRuns.standupId, schema.standupRuns.scheduledDate] })
    .returning();

  if (inserted.length === 0) {
    const [existing] = await db
      .select()
      .from(schema.standupRuns)
      .where(and(eq(schema.standupRuns.standupId, standup.id), eq(schema.standupRuns.scheduledDate, date)));
    return { run: existing, created: false };
  }

  const run = inserted[0];
  // Post the channel opening message once per run (best-effort) and store its ts for
  // threading. The "total" = count of reporting members. teamId may be null for callers
  // that don't guard it; skip the opening message in that case.
  try {
    if (standup.teamId) {
      const [team] = await db
        .select({ channelId: schema.teams.slackChannelId })
        .from(schema.teams)
        .where(eq(schema.teams.id, standup.teamId));
      const reporters = await db
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.canReport, true)));
      if (team?.channelId) {
        const opening = buildOpeningMessage({ standupName: standup.name, date, reported: 0, total: reporters.length });
        const openingTs = await slack.postMessage(team.channelId, opening.text, { blocks: opening.blocks });
        await db.update(schema.standupRuns).set({ channelOpeningTs: openingTs }).where(eq(schema.standupRuns.id, run.id));
        run.channelOpeningTs = openingTs;
      }
    }
  } catch (err) {
    console.warn(`[broadcast] opening message failed for run ${run.id}:`, (err as Error).message);
  }

  return { run, created: true };
}

/**
 * Open today's run and fan out a send-standup-dm job per reporting member. Idempotent: a
 * second tick the same day opens nothing and fans out nothing.
 */
export async function openRun(deps: OpenRunDeps, standupId: string, now: Date): Promise<OpenRunResult> {
  const { db, enqueueSend, slack } = deps;

  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, standupId));
  if (!standup || !standup.isActive) return { runId: null, enqueued: 0 };
  // teamId is nullable in the schema; without it the member query would match
  // nothing and silently open a run with zero sends — guard explicitly.
  if (!standup.teamId) return { runId: null, enqueued: 0 };
  if (!isActiveWeekday(standup.scheduleCron, standup.scheduleTz, now)) return { runId: null, enqueued: 0 };

  const { run, created } = await ensureRunOpen({ db, slack }, standup, now);
  if (!created) return { runId: null, enqueued: 0 }; // already open today — don't re-fan-out

  // At-least-once fan-out: the run row is committed before this loop, so if an
  // enqueue throws partway (e.g. Redis down) the run is left in "running" and the
  // remaining members aren't enqueued. Recovery (complete-run + timeout sweeper)
  // is Step 7; send-standup-dm itself is idempotent on (run_id, slack_user_id).
  const enqueued = await fanOutSends({ db, enqueueSend }, standup, run, now);
  return { runId: run.id, enqueued };
}

/**
 * Enqueue a send-standup-dm per reporting member of the standup's team (optionally excluding
 * one user — e.g. a re-trigger requester who's DMed directly). Each send is delayed to the
 * member's own tz-anchored send instant. Returns the number enqueued.
 */
export async function fanOutSends(
  deps: { db: Db; enqueueSend: EnqueueSend },
  standup: typeof schema.standups.$inferSelect,
  run: typeof schema.standupRuns.$inferSelect,
  now: Date,
  opts: { excludeUserId?: string } = {},
): Promise<number> {
  if (!standup.teamId) return 0;
  const members = await deps.db.select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.canReport, true)));
  let enqueued = 0;
  for (const m of members) {
    if (opts.excludeUserId && m.slackUserId === opts.excludeUserId) continue;
    const tz = m.timezone ?? standup.scheduleTz;
    const sendAt = computeSendInstant(standup.scheduleCron, tz, run.scheduledDate);
    const delayMs = Math.max(0, sendAt.getTime() - now.getTime());
    await deps.enqueueSend(
      { runId: run.id, standupId: standup.id, slackUserId: m.slackUserId, slackDisplayName: m.slackDisplayName },
      { delayMs },
    );
    enqueued++;
  }
  return enqueued;
}
