import { DataTable, Th, Td } from "@/components/ui/data-table";
import type { TeamMember } from "@poddaily/db/schema";

export function MemberTable({
  members, setPermAction, removeAction,
}: {
  members: TeamMember[];
  setPermAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
  if (members.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No members yet. Add one below.</div>;
  }
  return (
    <DataTable head={<><Th>Member</Th><Th>Timezone</Th><Th className="text-center">View</Th><Th className="text-center">Report</Th><Th className="text-center">Edit</Th><Th /></>}>
      {members.map((m) => (
        <tr key={m.id} className="hover:bg-surface-muted">
          <Td><span className="font-medium text-foreground">{m.slackDisplayName}</span> <span className="text-subtle-foreground">{m.slackUserId}</span></Td>
          <Td className="text-muted-foreground">{m.timezone ?? "—"}</Td>
          {(["canView", "canReport", "canEdit"] as const).map((perm) => (
            <Td key={perm} className="text-center">
              <form action={setPermAction} className="inline">
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="canView" value={String(perm === "canView" ? !m.canView : m.canView)} />
                <input type="hidden" name="canReport" value={String(perm === "canReport" ? !m.canReport : m.canReport)} />
                <input type="hidden" name="canEdit" value={String(perm === "canEdit" ? !m.canEdit : m.canEdit)} />
                <button type="submit" aria-label={`toggle ${perm}`} className={`h-4 w-4 rounded border ${m[perm] ? "border-accent bg-accent" : "border-input bg-background"}`} />
              </form>
            </Td>
          ))}
          <Td className="text-right">
            <form action={removeAction} className="inline">
              <input type="hidden" name="memberId" value={m.id} />
              <button type="submit" className="text-danger hover:underline">Remove</button>
            </form>
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}
