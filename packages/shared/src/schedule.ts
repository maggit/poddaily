export const WEEKDAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
] as const;

export interface WeeklySchedule {
  weekdays: number[]; // cron day-of-week numbers (0=Sun..6=Sat)
  hour: number;       // 0-23
  minute: number;     // 0-59
}

export function cronFromWeekly({ weekdays, hour, minute }: WeeklySchedule): string {
  const dows = [...new Set(weekdays)].sort((a, b) => a - b).join(",");
  return `${minute} ${hour} * * ${dows}`;
}

export function parseWeeklyCron(cron: string): WeeklySchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) throw new Error(`Unparseable cron: ${cron}`);
  const [m, h, , , dow] = parts;
  const weekdays: number[] = [];
  for (const token of dow.split(",")) {
    if (token.includes("-")) {
      const [a, b] = token.split("-").map(Number);
      for (let i = a; i <= b; i++) weekdays.push(i);
    } else {
      weekdays.push(Number(token));
    }
  }
  return {
    minute: Number(m),
    hour: Number(h),
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
  };
}
