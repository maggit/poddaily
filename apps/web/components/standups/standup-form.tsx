"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle, Field, Textarea, Input, FormError, type ActionState, type FormAction } from "@/components/ui/form";
import { QuestionEditor } from "./question-editor";
import { SchedulePicker } from "./schedule-picker";
import type { Question } from "@poddaily/shared";

export function StandupForm({
  action, questions, weekdays, hour, minute, tz, introMessage, outroMessage, reminderIntervalMinutes,
}: {
  action: FormAction;
  questions: Question[]; weekdays: number[]; hour: number; minute: number; tz: string;
  introMessage: string; outroMessage: string; reminderIntervalMinutes: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-5">
      <Card className="space-y-4">
        <SectionTitle description="What the bot asks each member, in order.">Questions</SectionTitle>
        <QuestionEditor initial={questions} name="questions" />
      </Card>

      <Card className="space-y-4">
        <SectionTitle description="When the standup is sent, in the team's default timezone.">Schedule</SectionTitle>
        <SchedulePicker initialWeekdays={weekdays} initialHour={hour} initialMinute={minute} initialTz={tz} />
      </Card>

      <Card className="space-y-4">
        <SectionTitle description="The messages that bookend each standup, plus reminders.">Messages</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Intro message">
            <Textarea name="introMessage" defaultValue={introMessage} rows={3} />
          </Field>
          <Field label="Outro message">
            <Textarea name="outroMessage" defaultValue={outroMessage} rows={3} />
          </Field>
          <Field label="Reminder interval" hint="In minutes. Set to 0 to disable reminders.">
            <Input type="number" name="reminderIntervalMinutes" defaultValue={reminderIntervalMinutes} min={0} step={5} />
          </Field>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-4">
        <div className="flex-1"><FormError>{state?.error}</FormError></div>
        <Button type="submit" variant="accent" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save standup"}
        </Button>
      </div>
    </form>
  );
}
