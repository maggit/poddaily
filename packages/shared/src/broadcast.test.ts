import { describe, it, expect } from "vitest";
import { buildOpeningMessage, buildReportBlocks } from "./broadcast";
import type { ReportAnswer } from "./questions";

describe("buildOpeningMessage", () => {
  it("renders the heading + counter as text and a single section block", () => {
    const { text, blocks } = buildOpeningMessage({
      standupName: "Daily Standup", date: "2026-06-20", reported: 1, total: 3,
    });
    expect(text).toContain("📋 *Daily Standup — 2026-06-20*");
    expect(text).toContain("Reported: 1 out of 3");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "section", text: { type: "mrkdwn" } });
  });
});

describe("buildReportBlocks", () => {
  const answers: ReportAnswer[] = [
    { questionId: "q1", questionText: "What did you do?", answer: "Shipped 6a" },
    { questionId: "q2", questionText: "What will you do?", answer: "Tests" },
  ];

  it("renders a header + divider + one section per Q&A", () => {
    const { text, blocks } = buildReportBlocks({
      standupName: "Daily Standup", displayName: "Raquel", answers,
    });
    expect(text).toContain("*Raquel* posted an update for Daily Standup");
    expect(text).toContain("What did you do?");
    expect(text).toContain("Shipped 6a");
    expect(blocks).toHaveLength(4); // header + divider + 2 Q&A
    expect(blocks[0]).toMatchObject({ type: "section" });
    expect(blocks[1]).toMatchObject({ type: "divider" });
    expect(blocks[2]).toMatchObject({ type: "section", text: { type: "mrkdwn", text: "*What did you do?*\nShipped 6a" } });
    expect(blocks[3]).toMatchObject({ type: "section", text: { type: "mrkdwn", text: "*What will you do?*\nTests" } });
  });

  it("handles a single-question standup", () => {
    const { blocks } = buildReportBlocks({
      standupName: "S", displayName: "X",
      answers: [{ questionId: "q1", questionText: "Q?", answer: "A" }],
    });
    expect(blocks).toHaveLength(3); // header + divider + 1
  });

  it("appends a 'Closed in Linear' section with linked issues when provided", () => {
    const { text, blocks } = buildReportBlocks({
      standupName: "Daily Standup", displayName: "Raquel", answers,
      linearIssues: [
        { identifier: "ENG-777", title: "Ship member search", url: "https://linear.app/x/ENG-777" },
        { identifier: "ENG-780", title: "Fix webhook auth", url: null },
      ],
    });
    expect(blocks).toHaveLength(5); // header + divider + 2 Q&A + linear section
    const linear = blocks[4] as { text: { text: string } };
    expect(linear.text.text).toContain("*Closed in Linear* · 2");
    expect(linear.text.text).toContain("<https://linear.app/x/ENG-777|ENG-777 Ship member search>");
    expect(linear.text.text).toContain("• ENG-780 Fix webhook auth"); // no url → plain
    expect(text).toContain("Closed in Linear (2):");
  });

  it("omits the Linear section when there are no issues", () => {
    const { blocks } = buildReportBlocks({ standupName: "S", displayName: "X", answers, linearIssues: [] });
    expect(blocks).toHaveLength(4); // header + divider + 2 Q&A, no linear section
  });
});
