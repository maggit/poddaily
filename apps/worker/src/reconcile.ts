import { deriveTickCron } from "@poddaily/shared";

export interface ActiveStandup {
  id: string;
  scheduleCron: string;
  scheduleTz: string;
}

/** A repeatable job currently registered in BullMQ, mapped to our shape. */
export interface ExistingJob {
  standupId: string;
  pattern: string;
  tz: string;
}

export interface DesiredJob {
  standupId: string;
  pattern: string;
  tz: string;
}

export interface ScheduleDiff {
  toAdd: DesiredJob[];
  toRemove: ExistingJob[];
}

/** Compute the repeatable-job changes needed to match `active` standups. */
export function diffSchedules(active: ActiveStandup[], existing: ExistingJob[]): ScheduleDiff {
  const desired: DesiredJob[] = active.map((s) => ({
    standupId: s.id,
    pattern: deriveTickCron(s.scheduleCron),
    tz: s.scheduleTz,
  }));

  const sameAsDesired = (e: ExistingJob) =>
    desired.some((d) => d.standupId === e.standupId && d.pattern === e.pattern && d.tz === e.tz);
  const alreadyExists = (d: DesiredJob) =>
    existing.some((e) => e.standupId === d.standupId && e.pattern === d.pattern && e.tz === d.tz);

  return {
    toAdd: desired.filter((d) => !alreadyExists(d)),
    toRemove: existing.filter((e) => !sameAsDesired(e)),
  };
}
