import { describe, it, expect } from "vitest";
import { diffSchedules, type ActiveStandup, type ExistingJob } from "./reconcile";

const standup = (id: string, cron: string, tz: string): ActiveStandup => ({ id, scheduleCron: cron, scheduleTz: tz });
const job = (standupId: string, pattern: string, tz: string): ExistingJob => ({ standupId, pattern, tz });

describe("diffSchedules", () => {
  it("adds a job for a standup with none", () => {
    const r = diffSchedules([standup("s1", "0 9 * * 1,2,3,4,5", "UTC")], []);
    expect(r.toAdd).toHaveLength(1);
    expect(r.toAdd[0]).toMatchObject({ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" });
    expect(r.toRemove).toHaveLength(0);
  });

  it("removes a job whose standup is no longer active", () => {
    const r = diffSchedules([], [job("s1", "5 0 * * 1,2,3,4,5", "UTC")]);
    expect(r.toAdd).toHaveLength(0);
    expect(r.toRemove).toEqual([{ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" }]);
  });

  it("recreates a job when the derived pattern or tz changed", () => {
    const active = [standup("s1", "0 9 * * 1,2,3", "UTC")];            // derived → "5 0 * * 1,2,3"
    const existing = [job("s1", "5 0 * * 1,2,3,4,5", "UTC")];          // stale weekdays
    const r = diffSchedules(active, existing);
    expect(r.toRemove).toEqual([{ standupId: "s1", pattern: "5 0 * * 1,2,3,4,5", tz: "UTC" }]);
    expect(r.toAdd[0]).toMatchObject({ standupId: "s1", pattern: "5 0 * * 1,2,3", tz: "UTC" });
  });

  it("leaves an unchanged job alone", () => {
    const active = [standup("s1", "0 9 * * 1,2,3,4,5", "UTC")];
    const existing = [job("s1", "5 0 * * 1,2,3,4,5", "UTC")];
    const r = diffSchedules(active, existing);
    expect(r.toAdd).toHaveLength(0);
    expect(r.toRemove).toHaveLength(0);
  });
});
