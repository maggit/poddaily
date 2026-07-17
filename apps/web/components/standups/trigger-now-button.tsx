"use client";
import { useActionState, useEffect, useState } from "react";
import { Send, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState, FormAction } from "@/components/ui/form";

/**
 * "Trigger now" — enqueues a forced open-run for a standup. Shows a transient
 * "Triggered" confirmation on success and the server error inline on failure.
 * Pass `teamId` when the action serves multiple teams (e.g. the Health page).
 */
export function TriggerNowButton({ action, teamId }: { action: FormAction; teamId?: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      setConfirmed(true);
      const t = setTimeout(() => setConfirmed(false), 4000);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      {teamId ? <input type="hidden" name="teamId" value={teamId} /> : null}
      {state?.error ? <span className="text-[12px] font-medium text-danger">{state.error}</span> : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending || confirmed} title="Send this standup to the team right now">
        {confirmed ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        {pending ? "Triggering…" : confirmed ? "Triggered" : "Trigger now"}
      </Button>
    </form>
  );
}
