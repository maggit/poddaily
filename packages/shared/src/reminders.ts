/**
 * The delays (ms from report-clock start) at which to fire reminders: every `intervalMs`
 * strictly before `timeoutMs`. `intervalMs <= 0` (reminders off) → []. Pure.
 */
export function reminderDelays(intervalMs: number, timeoutMs: number): number[] {
  if (intervalMs <= 0) return [];
  const out: number[] = [];
  for (let t = intervalMs; t < timeoutMs; t += intervalMs) out.push(t);
  return out;
}
