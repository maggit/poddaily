"use client";
import { useState } from "react";
import { WEEKDAYS, TIMEZONE_OPTIONS } from "@poddaily/shared";
import { Field, Input, Select } from "@/components/ui/form";

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
      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-foreground">Days</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = days.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggle(d.value)}
                aria-pressed={on}
                className={`h-9 w-12 rounded-lg border text-[13px] font-medium transition-colors ${
                  on
                    ? "border-accent bg-accent text-accent-foreground shadow-sm"
                    : "border-input bg-card text-muted-foreground shadow-xs hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Time" className="w-32">
          <Input type="time" name="time" defaultValue={time} />
        </Field>
        <Field label="Default timezone" className="w-72">
          <Select name="scheduleTz" defaultValue={initialTz}>
            {TIMEZONE_OPTIONS.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </Select>
        </Field>
      </div>
    </div>
  );
}
