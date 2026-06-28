import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SectionTitle, Field, Select } from "@/components/ui/form";
import type { AppUser } from "@poddaily/db/schema";

export function ManagersSection({
  managers, candidates, addAction, removeAction,
}: {
  managers: AppUser[];
  candidates: AppUser[];
  addAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
  const assignable = candidates.filter((c) => !managers.some((m) => m.slackUserId === c.slackUserId));
  return (
    <section className="space-y-4">
      <SectionTitle description="Managers can edit this team's members and standup. Promote someone to the manager role on the People page first.">
        Managers
      </SectionTitle>

      {managers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No managers assigned.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {managers.map((m) => (
            <li key={m.slackUserId} className="flex items-center gap-3 px-4 py-3 text-sm">
              <Avatar name={m.displayName ?? m.slackUserId} size={28} />
              <span className="font-medium text-foreground">{m.displayName ?? m.slackUserId}</span>
              <span className="font-mono text-[11.5px] text-subtle-foreground">{m.slackUserId}</span>
              <form action={removeAction} className="ml-auto">
                <input type="hidden" name="slackUserId" value={m.slackUserId} />
                <button type="submit" className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-foreground">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {assignable.length > 0 ? (
        <form action={addAction} className="flex items-end gap-3">
          <Field label="Assign manager" className="w-64">
            <Select name="slackUserId">
              {assignable.map((c) => <option key={c.slackUserId} value={c.slackUserId}>{(c.displayName ?? c.slackUserId)} ({c.slackUserId})</option>)}
            </Select>
          </Field>
          <Button type="submit">Assign</Button>
        </form>
      ) : null}
    </section>
  );
}
