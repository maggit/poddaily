"use client";
import { Button } from "@/components/ui/button";
import { QuestionEditor } from "./question-editor";
import { SchedulePicker } from "./schedule-picker";
import type { Question } from "@poddaily/shared";

export function StandupForm({
  action, questions, weekdays, hour, minute, tz, introMessage, outroMessage, reminderIntervalMinutes,
}: {
  action: (fd: FormData) => void | Promise<void>;
  questions: Question[]; weekdays: number[]; hour: number; minute: number; tz: string;
  introMessage: string; outroMessage: string; reminderIntervalMinutes: number;
}) {
  return (
    <form action={action} className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Questions</h2>
        <QuestionEditor initial={questions} name="questions" />
      </section>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Schedule</h2>
        <SchedulePicker initialWeekdays={weekdays} initialHour={hour} initialMinute={minute} initialTz={tz} />
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Intro message</span>
          <textarea name="introMessage" defaultValue={introMessage} rows={3} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Outro message</span>
          <textarea name="outroMessage" defaultValue={outroMessage} rows={3} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">Reminder interval (minutes, 0 = off)</span>
          <input type="number" name="reminderIntervalMinutes" defaultValue={reminderIntervalMinutes} min={0} step={5} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </section>
      <div className="flex justify-end"><Button type="submit">Save standup</Button></div>
    </form>
  );
}
