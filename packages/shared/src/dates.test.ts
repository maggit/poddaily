import { describe, it, expect } from "vitest";
import { interpolateLastReportDate } from "./dates";

describe("interpolateLastReportDate", () => {
  it("replaces {last_report_date} with a formatted date", () => {
    const out = interpolateLastReportDate(
      "What have you done since {last_report_date}?",
      new Date("2026-06-12T10:00:00Z"),
    );
    expect(out).toBe("What have you done since Friday, Jun 12?");
  });

  it("falls back to 'your last report' when no date is given", () => {
    const out = interpolateLastReportDate(
      "What have you done since {last_report_date}?",
      null,
    );
    expect(out).toBe("What have you done since your last report?");
  });

  it("leaves text without the token unchanged", () => {
    expect(interpolateLastReportDate("What will you do today?", null)).toBe(
      "What will you do today?",
    );
  });
});
