"use client";
import type { UserRole } from "@poddaily/db/schema";
import { Select } from "@/components/ui/form";

const ROLES: UserRole[] = ["viewer", "manager", "admin"];

export function RoleSelect({
  slackUserId, role, action,
}: {
  slackUserId: string;
  role: UserRole;
  action: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="slackUserId" value={slackUserId} />
      <Select
        name="role"
        defaultValue={role}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 w-32 capitalize"
      >
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </Select>
    </form>
  );
}
