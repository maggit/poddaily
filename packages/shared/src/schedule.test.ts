import { describe, it, expect } from "vitest";
import { WEEKDAYS, cronFromWeekly, parseWeeklyCron } from "./schedule";

describe("schedule cron helpers", () => {
  it("WEEKDAYS lists Mon..Sun with cron day-of-week numbers", () => {
    expect(WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(WEEKDAYS[0].label).toBe("Mon");
  });

  it("builds a weekly cron from weekdays + time", () => {
    expect(cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 })).toBe("0 10 * * 1,2,3,4,5");
    expect(cronFromWeekly({ weekdays: [1], hour: 9, minute: 30 })).toBe("30 9 * * 1");
  });

  it("sorts and dedupes weekdays", () => {
    expect(cronFromWeekly({ weekdays: [5, 1, 1, 3], hour: 8, minute: 5 })).toBe("5 8 * * 1,3,5");
  });

  it("parses a comma-list cron back to schedule", () => {
    expect(parseWeeklyCron("0 10 * * 1,2,3,4,5")).toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
  });

  it("parses a range cron (e.g. the seed) too", () => {
    expect(parseWeeklyCron("0 10 * * 1-5")).toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
  });

  it("round-trips", () => {
    const s = { weekdays: [1, 3, 5], hour: 14, minute: 15 };
    expect(parseWeeklyCron(cronFromWeekly(s))).toEqual({ minute: 15, hour: 14, weekdays: [1, 3, 5] });
  });
});
