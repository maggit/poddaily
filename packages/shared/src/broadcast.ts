import type { ReportAnswer } from "./questions";

/** A built Slack message: a plain-text fallback plus Block Kit blocks. */
export interface BuiltMessage {
  text: string;
  blocks: unknown[];
}

/** The header message for a run, with the live "Reported: n out of total" counter. Individual
 * reports post directly to the channel below it (not threaded), so it's a running header. */
export function buildOpeningMessage(args: {
  standupName: string;
  date: string;
  reported: number;
  total: number;
}): BuiltMessage {
  const { standupName, date, reported, total } = args;
  const text =
    `📋 *${standupName} — ${date}*\n` +
    `Reported: ${reported} out of ${total}`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

/** A completed issue to list under a report's "Closed in Linear" section. */
export interface LinearIssueRef {
  identifier: string | null;
  title: string | null;
  url: string | null;
}

/** Render one issue as a Slack mrkdwn bullet — a link when a url is present. */
function linearBullet(i: LinearIssueRef): string {
  const label = [i.identifier, i.title].filter(Boolean).join(" ") || i.identifier || "Issue";
  return i.url ? `• <${i.url}|${label}>` : `• ${label}`;
}

/** One member's report: a header section, a divider, one section per Q&A pair, and an optional
 *  "Closed in Linear" section listing issues they completed since their last standup. */
export function buildReportBlocks(args: {
  standupName: string;
  displayName: string;
  answers: ReportAnswer[];
  linearIssues?: LinearIssueRef[];
}): BuiltMessage {
  const { standupName, displayName, answers, linearIssues = [] } = args;
  const header = `*${displayName}* posted an update for ${standupName}`;
  const qaLines = answers.map((a) => `*${a.questionText}*\n${a.answer}`);

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "divider" },
    ...answers.map((a) => ({ type: "section", text: { type: "mrkdwn", text: `*${a.questionText}*\n${a.answer}` } })),
  ];

  const textLines = [header, ...qaLines];
  if (linearIssues.length > 0) {
    const heading = `*Closed in Linear* · ${linearIssues.length}`;
    const bullets = linearIssues.map(linearBullet).join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `${heading}\n${bullets}` } });
    textLines.push(`Closed in Linear (${linearIssues.length}): ${linearIssues.map((i) => [i.identifier, i.title].filter(Boolean).join(" ")).join(", ")}`);
  }

  return { text: textLines.join("\n"), blocks };
}
