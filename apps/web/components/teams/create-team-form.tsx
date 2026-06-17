import { Button } from "@/components/ui/button";

function Field({ label, name, placeholder, required }: { label: string; name: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">{label}{required ? <span className="text-danger"> *</span> : null}</span>
      <input name={name} placeholder={placeholder} required={required}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );
}

export function CreateTeamForm({ action }: { action: (fd: FormData) => void | Promise<void> }) {
  return (
    <form action={action} className="max-w-lg space-y-5 rounded-xl border border-border bg-card p-6">
      <Field label="Team name" name="name" placeholder="Platform Pod" required />
      <Field label="Tribe" name="tribe" placeholder="Infra" />
      <Field label="Slack channel name" name="slackChannelName" placeholder="platform-pod" required />
      <Field label="Slack channel ID" name="slackChannelId" placeholder="C0123456789" required />
      <p className="text-xs text-subtle-foreground">The Slack channel picker will replace manual entry once the bot is connected.</p>
      <div className="flex justify-end"><Button type="submit">Create team</Button></div>
    </form>
  );
}
