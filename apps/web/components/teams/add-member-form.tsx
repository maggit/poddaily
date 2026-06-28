"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { COMMON_TIMEZONES } from "@poddaily/shared";
import { Button } from "@/components/ui/button";
import { Field, Label, Select, FormError, type ActionState, type FormAction } from "@/components/ui/form";
import { MemberSearch, type DirUser } from "./member-search";

const DEFAULT_TZ = "America/Mexico_City";

export function AddMemberForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [selected, setSelected] = useState<DirUser | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setSelected(null);
      formRef.current?.reset();
    }
  }, [state]);

  // Use a valid known timezone from the picked user when available, else the default.
  const tz =
    selected?.tz && (COMMON_TIMEZONES as readonly string[]).includes(selected.tz) ? selected.tz : DEFAULT_TZ;

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
      {/* Server action reads these — populated from the directory selection. */}
      <input type="hidden" name="slackUserId" value={selected?.id ?? ""} />
      <input type="hidden" name="slackDisplayName" value={selected?.displayName ?? ""} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label>Teammate</Label>
          <MemberSearch selected={selected} onSelect={setSelected} />
        </div>
        <Field label="Timezone" className="w-48">
          {/* key resets the uncontrolled select's default when the selection changes */}
          <Select key={tz} name="timezone" defaultValue={tz}>
            {COMMON_TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={pending || !selected}>
          <UserPlus className="h-4 w-4" />
          {pending ? "Adding…" : "Add member"}
        </Button>
      </div>
      <FormError>{state?.error}</FormError>
    </form>
  );
}
