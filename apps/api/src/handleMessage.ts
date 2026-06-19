import { schema, eq, and, desc } from "@poddaily/db";
import { advanceReport } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleMessageDeps {
  db: Db;
  slack: SlackClient;
}

/** One inbound DM reply from a member. */
export interface IncomingDm {
  slackUserId: string;
  channel: string; // the DM channel id to reply into
  text: string;
}

const DEFAULT_OUTRO = "Thanks — your standup is in. ✅";
const ABORT_REPLY = "No problem — skipping today's standup. 👋";

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
  if (!report || !report.runId) return; // no open report — ignore stray DM

  const [run] = await db.select().from(schema.standupRuns).where(eq(schema.standupRuns.id, report.runId));
  if (!run || !run.standupId) return;
  const [standup] = await db.select().from(schema.standups).where(eq(schema.standups.id, run.standupId));
  if (!standup) return;

  const action = advanceReport({ questions: standup.questions, answers: report.answers, message: msg.text });

  switch (action.kind) {
    case "noop":
      return;

    case "abort":
      await db.update(schema.standupReports)
        .set({ status: "timed_out" })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, ABORT_REPLY);
      return;

    case "next":
      await db.update(schema.standupReports)
        .set({ answers: action.answers })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, action.question.text);
      return;

    case "complete":
      await db.update(schema.standupReports)
        .set({ answers: action.answers, status: "completed", reportedAt: new Date() })
        .where(eq(schema.standupReports.id, report.id));
      await slack.postMessage(msg.channel, standup.outroMessage ?? DEFAULT_OUTRO);
      return; // broadcast → Step 6
  }
}
