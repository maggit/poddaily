import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { listAppUsers, changeUserRole, LastAdminError } from "@/lib/users";
import type { UserRole } from "@poddaily/db/schema";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
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
    <div className="space-y-6">
      <PageHeader title="People" />
      <p className="text-sm text-muted-foreground">
        Roles gate who can edit teams and standups. Viewers are read-only; managers edit the teams they own; admins can do everything and assign roles.
      </p>
      {users.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No users yet.</div>
      ) : (
        <DataTable head={<><Th>Name</Th><Th>Slack ID</Th><Th>Email</Th><Th>Role</Th></>}>
          {users.map((u) => (
            <tr key={u.slackUserId} className="hover:bg-surface-muted">
              <Td><span className="font-medium text-foreground">{u.displayName ?? "—"}</span></Td>
              <Td className="text-subtle-foreground">{u.slackUserId}</Td>
              <Td className="text-muted-foreground">{u.email ?? "—"}</Td>
              <Td><RoleSelect slackUserId={u.slackUserId} role={u.role} action={setRoleAction} /></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
