import { describe, it, expect } from "vitest";
import { advanceReport } from "./dmEngine";
import type { Question, ReportAnswer } from "./questions";

const Q: Question[] = [
  { id: "q1", text: "What did you do?", type: "text" },
  { id: "q2", text: "What will you do?", type: "text" },
];

describe("advanceReport", () => {
  it("records the first answer and returns the next question", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "Shipped 5a" });
    expect(out).toEqual({
      kind: "next",
      answers: [{ questionId: "q1", questionText: "What did you do?", answer: "Shipped 5a" }],
      question: Q[1],
    });
  });

  it("completes after the final question is answered", () => {
    const answers: ReportAnswer[] = [
      { questionId: "q1", questionText: "What did you do?", answer: "Shipped 5a" },
    ];
    const out = advanceReport({ questions: Q, answers, message: "Build 5b" });
    expect(out.kind).toBe("complete");
    if (out.kind === "complete") expect(out.answers).toHaveLength(2);
  });

  it("trims whitespace from the answer", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "  hi  " });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("hi");
    else throw new Error("expected next");
  });

  it("`skip` records (skipped) and advances", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "skip" });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("(skipped)");
    else throw new Error("expected next");
  });

  it("`SKIP` is case-insensitive", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "  SKIP " });
    if (out.kind === "next") expect(out.answers[0].answer).toBe("(skipped)");
    else throw new Error("expected next");
  });

  it("`skip all` aborts without recording an answer", () => {
    const out = advanceReport({ questions: Q, answers: [], message: "skip all" });
    expect(out).toEqual({ kind: "abort" });
  });

  it("ignores a message once every question is answered (idempotent redelivery)", () => {
    const answers: ReportAnswer[] = [
      { questionId: "q1", questionText: "What did you do?", answer: "a" },
      { questionId: "q2", questionText: "What will you do?", answer: "b" },
    ];
    expect(advanceReport({ questions: Q, answers, message: "late reply" })).toEqual({ kind: "noop" });
  });
});
