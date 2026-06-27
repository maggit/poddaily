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
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium">Managers</h2>
      <p className="text-xs text-subtle-foreground">Managers can edit this team&apos;s members and standup. Promote someone to the manager role on the People page first.</p>
      {managers.length === 0 ? (
        <div className="text-sm text-muted-foreground">No managers assigned.</div>
      ) : (
        <ul className="space-y-1">
          {managers.map((m) => (
            <li key={m.slackUserId} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-foreground">{m.displayName ?? m.slackUserId}</span>
              <span className="text-subtle-foreground">{m.slackUserId}</span>
              <form action={removeAction} className="inline">
                <input type="hidden" name="slackUserId" value={m.slackUserId} />
                <button type="submit" className="text-danger hover:underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {assignable.length > 0 ? (
        <form action={addAction} className="flex items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-[13px] font-medium">Assign manager</span>
            <select name="slackUserId" className="h-9 w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
              {assignable.map((c) => <option key={c.slackUserId} value={c.slackUserId}>{(c.displayName ?? c.slackUserId)} ({c.slackUserId})</option>)}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Assign</button>
        </form>
      ) : null}
    </section>
  );
}
