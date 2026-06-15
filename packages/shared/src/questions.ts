export type QuestionType = "text";

export interface Question {
  id: string;
  text: string;
  hint?: string;
  type: QuestionType;
}

/** One answered question within a standup report's `answers` array. */
export interface ReportAnswer {
  questionId: string;
  questionText: string;
  answer: string;
}

export const DEFAULT_QUESTIONS: Question[] = [
  { id: "q1", text: "What have you done since {last_report_date}?", type: "text" },
  { id: "q2", text: "What will you do today?", type: "text" },
  { id: "q3", text: "Anything blocking your progress?", type: "text" },
  { id: "q4", text: "How do you feel today?", type: "text" },
];
