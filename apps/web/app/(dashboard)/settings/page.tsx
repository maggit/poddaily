import { LogOut, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/authz";
import { signOut } from "@/auth";
import type { UserRole } from "@poddaily/db/schema";
import { PageHeader } from "@/components/page-header";
import { Card, SectionTitle } from "@/components/ui/form";
import { StatusPill } from "@/components/ui/status-pill";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const ROLE_BLURB: Record<UserRole, string> = {
  admin: "Full access — create teams, edit any team, and assign roles and team managers.",
  manager: "Edit the teams you manage — their members and standup configuration.",
  viewer: "Read-only access to teams, standups, and reports.",
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-medium text-foreground">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const me = await getCurrentUser();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader eyebrow="Manage" title="Settings" description="Your account and access on this poddaily instance." />
      </div>

      <div className="reveal max-w-2xl space-y-5" style={{ animationDelay: "80ms" }}>
        <Card className="space-y-4">
          <SectionTitle>Account</SectionTitle>
          <div className="flex items-center gap-3">
            <Avatar name={me?.name ?? me?.slackUserId ?? "?"} size={44} />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{me?.name ?? "—"}</p>
              <p className="truncate text-[13px] text-muted-foreground">{me?.email ?? "No email on file"}</p>
            </div>
            {me ? (
              <span className="ml-auto">
                <StatusPill tone="neutral">
                  <span className="capitalize">{me.role}</span>
                </StatusPill>
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-border border-t border-border">
            <Detail label="Slack user ID" value={<span className="font-mono text-[12px]">{me?.slackUserId ?? "—"}</span>} />
            <Detail label="Role" value={<span className="capitalize">{me?.role ?? "—"}</span>} />
          </div>
        </Card>

        {me ? (
          <Card className="space-y-3">
            <SectionTitle>Access</SectionTitle>
            <div className="flex items-start gap-3 rounded-lg bg-accent-subtle p-3.5 text-accent">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[13px] leading-relaxed">{ROLE_BLURB[me.role]}</p>
            </div>
            <p className="text-[12.5px] leading-relaxed text-subtle-foreground">
              Roles are managed by admins on the People page. Instance configuration (Slack, database,
              scheduler) is set via environment variables — see the project README.
            </p>
          </Card>
        ) : null}

        <Card className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium text-foreground">Sign out</p>
            <p className="text-[13px] text-muted-foreground">End your session on this device.</p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
