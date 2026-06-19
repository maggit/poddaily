import type { Question, ReportAnswer } from "./questions";

/** The decision the engine makes for one incoming DM reply. */
export type DmAdvance =
  | { kind: "next"; answers: ReportAnswer[]; question: Question }
  | { kind: "complete"; answers: ReportAnswer[] }
  | { kind: "abort" }
  | { kind: "noop" };

const SKIP = "skip";
const SKIP_ALL = "skip all";

/**
 * Pure standup-DM reducer. Progress is `answers.length` (the index of the current
 * question). Stateless: the same (questions, answers, message) always yields the same
 * result, so a redelivered Slack event never double-advances.
 */
export function advanceReport(args: {
  questions: Question[];
  answers: ReportAnswer[];
  message: string;
}): DmAdvance {
  const { questions, answers, message } = args;

  // Already finished (or misconfigured with no questions) → ignore stray replies.
  if (answers.length >= questions.length) return { kind: "noop" };

  const normalized = message.trim().toLowerCase();
  if (normalized === SKIP_ALL) return { kind: "abort" };

  const current = questions[answers.length];
  const answerText = normalized === SKIP ? "(skipped)" : message.trim();
  const nextAnswers: ReportAnswer[] = [
    ...answers,
    { questionId: current.id, questionText: current.text, answer: answerText },
  ];

  if (nextAnswers.length >= questions.length) {
    return { kind: "complete", answers: nextAnswers };
  }
  return { kind: "next", answers: nextAnswers, question: questions[nextAnswers.length] };
}
