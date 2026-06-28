import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { listAppUsers, changeUserRole, LastAdminError } from "@/lib/users";
import type { UserRole } from "@poddaily/db/schema";
import { UsersRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { RoleSelect } from "@/components/people/role-select";

const ROLE_VALUES: UserRole[] = ["viewer", "manager", "admin"];

export default async function PeoplePage() {
  await requireAdmin();
  const users = await listAppUsers();

  async function setRoleAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const slackUserId = String(fd.get("slackUserId") ?? "");
    const role = String(fd.get("role") ?? "") as UserRole;
    if (!slackUserId || !ROLE_VALUES.includes(role)) throw new Error("Invalid role change");
    try {
      await changeUserRole(slackUserId, role);
    } catch (err) {
      if (err instanceof LastAdminError) throw new Error("Cannot remove the last admin");
      throw err;
    }
    revalidatePath("/people");
  }

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Manage"
          title="People"
          description="Roles gate who can edit teams and standups. Viewers are read-only; managers edit the teams they own; admins can do everything and assign roles."
        />
      </div>
      {users.length === 0 ? (
        <div className="reveal">
          <EmptyState icon={UsersRound} title="No users yet" description="People appear here after they sign in with Slack." />
        </div>
      ) : (
        <div className="reveal" style={{ animationDelay: "80ms" }}>
          <DataTable head={<><Th>Name</Th><Th>Slack ID</Th><Th>Email</Th><Th>Role</Th></>}>
            {users.map((u) => (
              <tr key={u.slackUserId} className="hover:bg-surface-muted/60">
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.displayName ?? u.slackUserId} size={30} />
                    <span className="font-medium text-foreground">{u.displayName ?? "—"}</span>
                  </div>
                </Td>
                <Td className="font-mono text-[12px] text-subtle-foreground">{u.slackUserId}</Td>
                <Td className="text-muted-foreground">{u.email ?? "—"}</Td>
                <Td><RoleSelect slackUserId={u.slackUserId} role={u.role} action={setRoleAction} /></Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
