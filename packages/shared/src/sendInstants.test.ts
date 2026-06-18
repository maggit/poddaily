import { describe, it, expect } from "vitest";
import { computeSendInstant, anchorDate, isActiveWeekday, deriveTickCron } from "./sendInstants";
import { cronFromWeekly } from "./schedule";

// "9:00 on Mon-Fri" in cron terms
const CRON = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 0 });

describe("anchorDate", () => {
  it("returns the calendar date in scheduleTz", () => {
    // 2026-06-17T02:00:00Z is still 2026-06-16 in America/Mexico_City (UTC-6)
    const instant = new Date("2026-06-17T02:00:00Z");
    expect(anchorDate("America/Mexico_City", instant)).toBe("2026-06-16");
    expect(anchorDate("UTC", instant)).toBe("2026-06-17");
  });
});

describe("isActiveWeekday", () => {
  it("true on a configured weekday, evaluated in scheduleTz", () => {
    // 2026-06-17 is a Wednesday
    const wed = new Date("2026-06-17T12:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", wed)).toBe(true);
  });
  it("false on a non-configured weekday", () => {
    // 2026-06-20 is a Saturday
    const sat = new Date("2026-06-20T12:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", sat)).toBe(false);
  });
  it("uses scheduleTz to decide the weekday at a date boundary", () => {
    // 2026-06-22T02:00Z is Mon in UTC but still Sun in America/Mexico_City
    const instant = new Date("2026-06-22T02:00:00Z");
    expect(isActiveWeekday(CRON, "UTC", instant)).toBe(true);              // Monday
    expect(isActiveWeekday(CRON, "America/Mexico_City", instant)).toBe(false); // Sunday
  });
});

describe("computeSendInstant", () => {
  it("is the member's local configured time on the anchor date", () => {
    // anchor 2026-06-17, member in New York (UTC-4 in June) → 09:00 EDT = 13:00Z
    const instant = computeSendInstant(CRON, "America/New_York", "2026-06-17");
    expect(instant.toISOString()).toBe("2026-06-17T13:00:00.000Z");
  });
  it("differs per member timezone for the same anchor date", () => {
    const ny = computeSendInstant(CRON, "America/New_York", "2026-06-17");   // 13:00Z
    const ldn = computeSendInstant(CRON, "Europe/London", "2026-06-17");      // 09:00 BST = 08:00Z
    expect(ldn.toISOString()).toBe("2026-06-17T08:00:00.000Z");
    expect(ny.getTime()).toBeGreaterThan(ldn.getTime());
  });
  it("handles a winter (standard time) offset correctly", () => {
    // January: New York is UTC-5 → 09:00 EST = 14:00Z
    const instant = computeSendInstant(CRON, "America/New_York", "2026-01-14");
    expect(instant.toISOString()).toBe("2026-01-14T14:00:00.000Z");
  });
});

describe("deriveTickCron", () => {
  it("reuses weekdays but fires at 00:05", () => {
    expect(deriveTickCron(CRON)).toBe("5 0 * * 1,2,3,4,5");
  });
});
