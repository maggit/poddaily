import { DateTime } from "luxon";
import { parseWeeklyCron } from "./schedule";

/** Convert a Luxon weekday (1=Mon..7=Sun) to a cron day-of-week (0=Sun..6=Sat). */
function luxonToCronDow(weekday: number): number {
  return weekday === 7 ? 0 : weekday;
}

/** The run's anchor calendar date (YYYY-MM-DD) for `instant`, evaluated in `scheduleTz`. */
export function anchorDate(scheduleTz: string, instant: Date): string {
  const iso = DateTime.fromJSDate(instant, { zone: scheduleTz }).toISODate();
  if (!iso) throw new Error(`Invalid instant/zone: ${instant.toISOString()} / ${scheduleTz}`);
  return iso;
}

/** Is `instant`'s date an active weekday for this standup, evaluated in `scheduleTz`? */
export function isActiveWeekday(cron: string, scheduleTz: string, instant: Date): boolean {
  const { weekdays } = parseWeeklyCron(cron);
  const dt = DateTime.fromJSDate(instant, { zone: scheduleTz });
  return weekdays.includes(luxonToCronDow(dt.weekday));
}

/**
 * The UTC instant at which a member in `memberTz` should be DM'd for the run
 * anchored on `anchorDateISO` (a YYYY-MM-DD date in the standup's scheduleTz),
 * at the standup's configured local time. Luxon resolves the IANA offset
 * (including DST) for that wall-clock time in `memberTz`.
 */
export function computeSendInstant(cron: string, memberTz: string, anchorDateISO: string): Date {
  const { hour, minute } = parseWeeklyCron(cron);
  const dt = DateTime.fromISO(anchorDateISO, { zone: memberTz }).set({
    hour, minute, second: 0, millisecond: 0,
  });
  if (!dt.isValid) throw new Error(`Invalid send instant for ${memberTz} on ${anchorDateISO}: ${dt.invalidReason}`);
  return dt.toJSDate();
}

/** Repeatable-tick cron derived from a standup cron: same weekdays, fires at 00:05. */
export function deriveTickCron(cron: string): string {
  const { weekdays } = parseWeeklyCron(cron);
  const dows = [...new Set(weekdays)].sort((a, b) => a - b).join(",");
  return `5 0 * * ${dows}`;
}
