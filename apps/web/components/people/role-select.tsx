"use client";
import type { UserRole } from "@poddaily/db/schema";

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
      <select
        name="role"
        defaultValue={role}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </form>
  );
}
