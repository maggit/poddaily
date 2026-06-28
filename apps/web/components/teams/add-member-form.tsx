"use client";
import { useActionState, useEffect, useRef } from "react";
import { UserPlus } from "lucide-react";
import { COMMON_TIMEZONES } from "@poddaily/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, FormError, type ActionState, type FormAction } from "@/components/ui/form";

export function AddMemberForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Display name" className="w-44">
          <Input name="slackDisplayName" required placeholder="Ada Lovelace" />
        </Field>
        <Field label="Slack user ID" className="w-40">
          <Input name="slackUserId" required placeholder="U0123456789" />
        </Field>
        <Field label="Timezone" className="w-48">
          <Select name="timezone" defaultValue="America/Mexico_City">
            {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          <UserPlus className="h-4 w-4" />
          {pending ? "Adding…" : "Add member"}
        </Button>
      </div>
      <FormError>{state?.error}</FormError>
    </form>
  );
}
