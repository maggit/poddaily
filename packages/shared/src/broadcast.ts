import type { ReportAnswer } from "./questions";

/** A built Slack message: a plain-text fallback plus Block Kit blocks. */
export interface BuiltMessage {
  text: string;
  blocks: unknown[];
}

/** The opening thread message for a run, with the live "Reported: n out of total" counter. */
export function buildOpeningMessage(args: {
  standupName: string;
  date: string;
  reported: number;
  total: number;
}): BuiltMessage {
  const { standupName, date, reported, total } = args;
  const text =
    `📋 *${standupName} — ${date}*\n` +
    `Find all reports for *${standupName}, ${date}* in this thread.\n` +
    `Reported: ${reported} out of ${total}`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

/** One member's report: a header section, a divider, then one section per Q&A pair. */
export function buildReportBlocks(args: {
  standupName: string;
  displayName: string;
  answers: ReportAnswer[];
}): BuiltMessage {
  const { standupName, displayName, answers } = args;
  const header = `*${displayName}* posted an update for ${standupName}`;
  const qaLines = answers.map((a) => `*${a.questionText}*\n${a.answer}`);
  const text = [header, ...qaLines].join("\n");
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    { type: "divider" },
    ...answers.map((a) => ({ type: "section", text: { type: "mrkdwn", text: `*${a.questionText}*\n${a.answer}` } })),
  ];
  return { text, blocks };
}
