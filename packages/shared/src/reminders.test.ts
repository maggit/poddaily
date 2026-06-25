import { describe, it, expect } from "vitest";
import { reminderDelays } from "./reminders";

const M = 60_000;
describe("reminderDelays", () => {
  it("returns each interval multiple strictly before the timeout", () => {
    expect(reminderDelays(60 * M, 240 * M)).toEqual([60 * M, 120 * M, 180 * M]);
  });
  it("excludes a multiple that lands exactly on the timeout", () => {
    expect(reminderDelays(120 * M, 240 * M)).toEqual([120 * M]);
  });
  it("returns [] when the interval is 0 or negative (reminders off)", () => {
    expect(reminderDelays(0, 240 * M)).toEqual([]);
    expect(reminderDelays(-5, 240 * M)).toEqual([]);
  });
  it("returns [] when the interval is >= the timeout", () => {
    expect(reminderDelays(300 * M, 240 * M)).toEqual([]);
  });
});
