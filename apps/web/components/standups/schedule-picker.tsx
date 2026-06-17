"use client";
import { useState } from "react";
import { WEEKDAYS, COMMON_TIMEZONES } from "@poddaily/shared";

export function SchedulePicker({
  initialWeekdays, initialHour, initialMinute, initialTz,
}: {
  initialWeekdays: number[]; initialHour: number; initialMinute: number; initialTz: string;
}) {
  const [days, setDays] = useState<number[]>(initialWeekdays);
  const time = `${String(initialHour).padStart(2, "0")}:${String(initialMinute).padStart(2, "0")}`;

  const toggle = (v: number) =>
    setDays((xs) => (xs.includes(v) ? xs.filter((d) => d !== v) : [...xs, v]));

  return (
    <div className="space-y-4">
      <input type="hidden" name="weekdays" value={days.join(",")} readOnly />
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.value);
          return (
            <button key={d.value} type="button" onClick={() => toggle(d.value)}
              className={`h-9 w-12 rounded-lg border text-[13px] font-medium ${on ? "border-accent bg-accent-subtle text-accent" : "border-input bg-background text-muted-foreground hover:bg-muted"}`}>
              {d.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Time</span>
          <input type="time" name="time" defaultValue={time} className="h-9 w-32 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Default timezone</span>
          <select name="scheduleTz" defaultValue={initialTz} className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
            {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
