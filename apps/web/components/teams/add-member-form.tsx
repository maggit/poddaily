import { COMMON_TIMEZONES } from "@poddaily/shared";
import { Button } from "@/components/ui/button";

export function AddMemberForm({ action }: { action: (fd: FormData) => void | Promise<void> }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Display name</span>
        <input name="slackDisplayName" required placeholder="Ada Lovelace" className="h-9 w-44 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Slack user ID</span>
        <input name="slackUserId" required placeholder="U0123456789" className="h-9 w-40 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Timezone</span>
        <select name="timezone" defaultValue="America/Mexico_City" className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
          {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>
      <Button type="submit">Add member</Button>
    </form>
  );
}
