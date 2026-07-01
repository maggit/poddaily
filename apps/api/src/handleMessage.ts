import { schema, eq, and, desc, getUserToken, finalizeRunIfDone, lastReportDateBefore } from "@poddaily/db";
import { advanceReport, buildOpeningMessage, buildReportBlocks, interpolateLastReportDate } from "@poddaily/shared";
import { getMemberDayState } from "./standupState";
import type { ReportAnswer, RetriggerJob } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleMessageDeps {
  db: Db;
  slack: SlackClient;
  secret: string;
  makeUserSlack: (token: string) => SlackClient;
  enqueueRetrigger: (job: RetriggerJob) => Promise<void>;
}

/** One inbound DM reply from a member. */
export interface IncomingDm {
  slackUserId: string;
  channel: string; // the DM channel id to reply into
  text: string;
}

const DEFAULT_OUTRO = "Thanks — your standup is in. ✅";
const ABORT_REPLY = "No problem — skipping today's standup. 👋";
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * Reconstruct progress from the user's open report, advance it via the pure reducer,
 * persist, and post the next message. Stateless: no conversation store. Channel
 * broadcast on completion is Step 6 — here we only post the outro into the DM.
 */
export async function handleMessage(deps: HandleMessageDeps, msg: IncomingDm): Promise<void> {
  const { db, slack } = deps;

  // The user's currently-open report is the conversation they're answering (Phase 1:
  // one standup per team, so the most-recent in_progress row is unambiguous).
  const [report] = await db
    .select()
    .from(schema.standupReports)
    .where(and(
      eq(schema.standupReports.slackUserId, msg.slackUserId),
      eq(schema.standupReports.status, "in_progress"),
    ))
    .orderBy(desc(schema.standupReports.createdAt))
    .limit(1);
  // Concurrent distinct messages from the same user are last-write-wins. Acceptable at
  // human typing cadence; the reducer's purity guards redelivery, not concurrency.
  if (!report || !report.runId) {
    await maybeRetrigger(deps, msg);
    return;
  }

  const [run] = await db.select().from(schema.standupRuns).where(eq(schema.standupRuns.id, report.runId));
  if (!run || !run.standupId) return;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, run.standupId));
  if (!standup) return;

  const action = advanceReport({ questions: standup.questions, answers: report.answers, message: msg.text });

  switch (action.kind) {
    case "noop":
      return;

    case "abort":
      // timed_out rows keep reportedAt at its insert-time defaultNow(); downstream consumers
      // must filter on status (e.g. sendDm's last_report_date lookup filters status = "completed").
      await db.update(schema.standupReports)
        .set({ status: "timed_out" })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, ABORT_REPLY);
      try {
        await finalizeRunIfDone(db, run.id);
      } catch (err) {
        console.warn(`[finalize] degraded for run ${run.id}:`, (err as Error).message);
      }
      return;

    case "next": {
      const timeoutMs = Number(process.env.STANDUP_TIMEOUT_MS ?? FOUR_HOURS_MS);
      await db.update(schema.standupReports)
        .set({ answers: action.answers, timeoutAt: new Date(Date.now() + timeoutMs) })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, action.question.text);
      return;
    }

    case "complete":
      await db.update(schema.standupReports)
        .set({ answers: action.answers, status: "completed", reportedAt: new Date() })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, standup.outroMessage ?? DEFAULT_OUTRO);
      await broadcastReport(deps, { report, run, standup, answers: action.answers });
      try {
        await finalizeRunIfDone(db, run.id);
      } catch (err) {
        console.warn(`[finalize] degraded for run ${run.id}:`, (err as Error).message);
      }
      return;
  }
}

/**
 * Best-effort channel broadcast: post the completed report as a threaded reply under the
 * run's opening message, persist the post ts, and refresh the "Reported: n out of total"
 * counter. When the member has a stored user token we post AS THE USER (true authorship,
 * no username/icon override → Slack counts it as the member, no "APP" badge). Otherwise
 * (or on a user-token post failure) we degrade: the bot posts with the member's name/avatar
 * via chat:write.customize plus a Connect nudge. Any failure is logged and swallowed so a
 * broadcast problem never reverts the completed report.
 */
async function broadcastReport(
  deps: HandleMessageDeps,
  ctx: {
    report: typeof schema.standupReports.$inferSelect;
    run: typeof schema.standupRuns.$inferSelect;
    standup: typeof schema.standups.$inferSelect;
    answers: ReportAnswer[];
  },
): Promise<void> {
  const { db, slack, secret, makeUserSlack } = deps;
  const { report, run, standup, answers } = ctx;
  try {
    if (!standup.teamId) return;

    const [team] = await db
      .select({ channelId: schema.teams.slackChannelId })
      .from(schema.teams)
      .where(eq(schema.teams.id, standup.teamId));
    if (!team?.channelId) return;

    const lastDate = await lastReportDateBefore(db, report.slackUserId, report.createdAt ?? new Date());
    const built = buildReportBlocks({
      standupName: standup.name,
      displayName: report.slackDisplayName,
      answers: answers.map((a) => ({ ...a, questionText: interpolateLastReportDate(a.questionText, lastDate) })),
    });
    let token: string | null = null;
    try {
      token = await getUserToken(db, secret, report.slackUserId);
    } catch (err) {
      console.warn(`[broadcast] could not read user token for ${report.slackUserId}; degrading:`, (err as Error).message);
    }

    let postTs: string | null = null;
    if (token) {
      // Post AS THE USER — true authorship, no username/icon override. Slack counts it
      // as the user's message (no "APP" badge). Posted to the channel (not threaded) so
      // updates are visible in the main channel feed.
      try {
        postTs = await makeUserSlack(token).postMessage(team.channelId, built.text, {
          blocks: built.blocks,
        });
      } catch (err) {
        console.warn(`[broadcast] user-token post failed for ${report.slackUserId}; degrading:`, (err as Error).message);
      }
    }
    if (!postTs) {
      // Degraded: bot posts with the member's name/avatar + a Connect nudge.
      const [member] = await db
        .select({ avatar: schema.teamMembers.slackAvatarUrl })
        .from(schema.teamMembers)
        .where(and(
          eq(schema.teamMembers.teamId, standup.teamId),
          eq(schema.teamMembers.slackUserId, report.slackUserId),
        ));
      const webUrl = process.env.NEXTAUTH_URL;
      const blocks = webUrl
        ? [...(built.blocks as unknown[]), {
            type: "context",
            elements: [{ type: "mrkdwn", text: `_${report.slackDisplayName} hasn't connected — <${webUrl}/api/slack/install|Connect to post as yourself>_` }],
          }]
        : built.blocks;
      postTs = await slack.postMessage(team.channelId, built.text, {
        username: report.slackDisplayName,
        iconUrl: member?.avatar ?? undefined,
        blocks,
      });
    }

    await db.update(schema.standupReports)
      .set({ channelPostTs: postTs })
      .where(eq(schema.standupReports.id, report.id));

    // Best-effort live "Reported: n out of total" counter on the opening/header message,
    // if one was posted. The report is already in the channel regardless.
    if (run.channelOpeningTs) {
      const all = await db
        .select({ status: schema.standupReports.status })
        .from(schema.standupReports)
        .where(eq(schema.standupReports.runId, run.id));
      const total = all.length;
      const reported = all.filter((r) => r.status === "completed").length;
      const opening = buildOpeningMessage({
        standupName: standup.name,
        date: run.scheduledDate,
        reported,
        total,
      });
      await slack.updateMessage(team.channelId, run.channelOpeningTs, { text: opening.text, blocks: opening.blocks });
    }
  } catch (err) {
    console.warn(`[broadcast] degraded for report ${report.id}:`, (err as Error).message);
  }
}

const RETRIGGER_KEYWORDS = new Set(["redo", "restart", "start", "standup"]);

/**
 * When a member with no open report DMs a re-trigger keyword, (re)start their standup for
 * today — unless they've already completed it. No-op for non-keyword messages.
 */
async function maybeRetrigger(deps: HandleMessageDeps, msg: IncomingDm): Promise<void> {
  const { slack, enqueueRetrigger } = deps;
  if (!RETRIGGER_KEYWORDS.has(msg.text.trim().toLowerCase())) return;

  const state = await getMemberDayState(deps.db, msg.slackUserId);
  if (state.kind === "not_member") {
    await slack.postMessage(msg.channel, "You're not set up for a standup yet.");
    return;
  }
  if (state.kind === "no_standup") {
    await slack.postMessage(msg.channel, "Your team has no standup configured yet.");
    return;
  }
  if (state.kind === "paused") {
    await slack.postMessage(msg.channel, "This standup is paused — ask an admin to resume it.");
    return;
  }
  if (state.kind === "completed") {
    await slack.postMessage(msg.channel, "You've already reported today ✅");
    return;
  }

  // in_progress or pending → (re)start. The worker retrigger() leaves an in_progress report
  // untouched and re-opens absent/timed_out ones; this matches the prior behavior (enqueue
  // unless already completed).
  await enqueueRetrigger({
    standupId: state.standup!.id,
    slackUserId: msg.slackUserId,
    slackDisplayName: state.member!.slackDisplayName,
    channel: msg.channel,
  });
  await slack.postMessage(msg.channel, "📋 Restarting your standup…");
}
