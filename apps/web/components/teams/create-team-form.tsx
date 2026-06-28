"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Field, Input, FormError, type ActionState, type FormAction } from "@/components/ui/form";

export function CreateTeamForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);

  return (
    <Card className="max-w-lg">
      <form action={formAction} className="space-y-5">
        <Field label="Team name" required>
          <Input name="name" placeholder="Platform Pod" required />
        </Field>
        <Field label="Tribe">
          <Input name="tribe" placeholder="Infra" />
        </Field>
        <Field label="Slack channel name" required>
          <Input name="slackChannelName" placeholder="platform-pod" required />
        </Field>
        <Field
          label="Slack channel ID"
          required
          hint="The Slack channel picker will replace manual entry once the bot is connected."
        >
          <Input name="slackChannelId" placeholder="C0123456789" required />
        </Field>
        <FormError>{state?.error}</FormError>
        <div className="flex justify-end border-t border-border pt-5">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? "Creating…" : "Create team"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
