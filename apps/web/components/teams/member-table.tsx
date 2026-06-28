import { Check, UsersRound } from "lucide-react";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import type { TeamMember } from "@poddaily/db/schema";

function Toggle({ on, interactive }: { on: boolean; interactive: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition-colors ${
        on
          ? "border-accent bg-accent text-accent-foreground"
          : `border-input bg-card ${interactive ? "group-hover/cell:border-muted-foreground" : ""}`
      }`}
    >
      {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </span>
  );
}

export function MemberTable({
  members, connectedUserIds, editable = true, setPermAction, removeAction,
}: {
  members: TeamMember[];
  connectedUserIds: string[];
  editable?: boolean;
  setPermAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
  const connected = new Set(connectedUserIds);
  if (members.length === 0) {
    return <EmptyState icon={UsersRound} title="No members yet" description="Add a member below to start collecting their standups." />;
  }
  return (
    <DataTable head={<><Th>Member</Th><Th>Timezone</Th><Th className="text-center">View</Th><Th className="text-center">Report</Th><Th className="text-center">Edit</Th><Th>Slack</Th><Th className="text-right" /></>}>
      {members.map((m) => (
        <tr key={m.id} className="hover:bg-surface-muted/60">
          <Td>
            <div className="flex items-center gap-3">
              <Avatar name={m.slackDisplayName} size={30} />
              <div className="min-w-0">
                <span className="font-medium text-foreground">{m.slackDisplayName}</span>
                <p className="truncate font-mono text-[11.5px] text-subtle-foreground">{m.slackUserId}</p>
              </div>
            </div>
          </Td>
          <Td className="text-muted-foreground">{m.timezone ?? "—"}</Td>
          {(["canView", "canReport", "canEdit"] as const).map((perm) => (
            <Td key={perm} className="text-center">
              {editable ? (
                <form action={setPermAction} className="group/cell inline">
                  <input type="hidden" name="memberId" value={m.id} />
                  <input type="hidden" name="canView" value={String(perm === "canView" ? !m.canView : m.canView)} />
                  <input type="hidden" name="canReport" value={String(perm === "canReport" ? !m.canReport : m.canReport)} />
                  <input type="hidden" name="canEdit" value={String(perm === "canEdit" ? !m.canEdit : m.canEdit)} />
                  <button type="submit" aria-label={`toggle ${perm}`} className="cursor-pointer rounded-md p-1 align-middle">
                    <Toggle on={!!m[perm]} interactive />
                  </button>
                </form>
              ) : (
                <span aria-label={perm} className="inline-block align-middle">
                  <Toggle on={!!m[perm]} interactive={false} />
                </span>
              )}
            </Td>
          ))}
          <Td>
            {connected.has(m.slackUserId)
              ? <StatusPill tone="success">Connected</StatusPill>
              : <StatusPill tone="neutral">Not connected</StatusPill>}
          </Td>
          <Td className="text-right">
            {editable ? (
              <form action={removeAction} className="inline">
                <input type="hidden" name="memberId" value={m.id} />
                <button type="submit" className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger-foreground">
                  Remove
                </button>
              </form>
            ) : null}
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}
