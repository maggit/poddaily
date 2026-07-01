import { revalidatePath } from "next/cache";
import { CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { encryptToken } from "@poddaily/shared";
import { getIntegrationSetting, countLinearActivity, upsertIntegrationSetting, listUnmatchedLinearAssignees } from "@poddaily/db";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, SectionTitle, Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CopyField } from "@/components/integrations/copy-field";

const COMING_SOON = [
  { name: "GitHub", initial: "GH", color: "#1F2328", blurb: "Merged PRs and commits in your check-in." },
  { name: "Google Meet", initial: "M", color: "#00897B", blurb: "Meetings you attended, summarized." },
  { name: "Zoom", initial: "Z", color: "#2D8CFF", blurb: "Zoom meetings in your check-in." },
];

function Logo({ initial, color }: { initial: string; color: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white shadow-sm"
      style={{ backgroundColor: color }}
    >
      {initial}
    </span>
  );
}

export default async function IntegrationsPage() {
  await requireAdmin();

  const webUrl = process.env.NEXTAUTH_URL ?? "";
  const payloadUrl = `${webUrl}/api/integrations/linear/webhook`;
  const linear = await getIntegrationSetting(db, "linear");
  const issueCount = await countLinearActivity(db);
  const unmatched = issueCount > 0 ? await listUnmatchedLinearAssignees(db) : [];
  const hasSecret = Boolean(linear?.secretCiphertext);
  const connected = issueCount > 0 || hasSecret;

  async function saveLinearSecretAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const secret = String(fd.get("secret") ?? "").trim();
    // Only overwrite the stored secret when a new one is entered; always mark enabled.
    await upsertIntegrationSetting(db, "linear", {
      enabled: true,
      ...(secret ? { secretCiphertext: encryptToken(secret, process.env.INTERNAL_API_SECRET ?? "") } : {}),
    });
    revalidatePath("/integrations");
  }

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Manage"
          title="Integrations"
          description="Connect external tools so a member's recent activity shows up in their standup. Activity is matched to the member by email."
        />
      </div>

      {/* Linear — active */}
      <Card className="reveal space-y-5" >
        <div className="flex items-start gap-3">
          <Logo initial="L" color="#5E6AD2" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-[16px] font-semibold tracking-tight text-foreground">Linear</h2>
              {connected ? <StatusPill tone="success">Connected</StatusPill> : <StatusPill tone="neutral">Not set up</StatusPill>}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Surface the issues you closed yesterday in your standup&apos;s &ldquo;Previously&rdquo; section.
            </p>
          </div>
          <span className="shrink-0 text-[12px] text-subtle-foreground tabular-nums">
            {issueCount} {issueCount === 1 ? "issue" : "issues"} tracked
          </span>
        </div>

        <div className="space-y-2 border-t border-border pt-5">
          <p className="text-[13px] font-medium text-foreground">Payload URL</p>
          <CopyField value={payloadUrl} />
          {!webUrl ? (
            <p className="text-[12px] text-warning-foreground">
              Set <code className="font-mono">NEXTAUTH_URL</code> so this URL is complete.
            </p>
          ) : null}
        </div>

        <div className="space-y-2.5 rounded-lg bg-surface-muted p-4">
          <p className="text-[13px] font-medium text-foreground">Set it up in Linear</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted-foreground">
            <li>In Linear, open <span className="font-medium text-foreground">Settings → API → Webhooks</span> and select <span className="font-medium text-foreground">Create new webhook</span>.</li>
            <li>Label it <span className="font-medium text-foreground">poddaily</span>.</li>
            <li>Paste the <span className="font-medium text-foreground">Payload URL</span> above into the <span className="font-medium text-foreground">URL</span> field.</li>
            <li>Under <span className="font-medium text-foreground">Data change events</span>, enable <span className="font-medium text-foreground">Issues</span>.</li>
            <li>Leave <span className="font-medium text-foreground">Teams</span> unrestricted (all teams) — poddaily matches activity to people by email, not by Linear team, so there&apos;s no need to pick specific teams.</li>
            <li>Select <span className="font-medium text-foreground">Create webhook</span>.</li>
          </ol>
          <p className="flex items-start gap-1.5 pt-1 text-[12.5px] text-subtle-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            poddaily only processes <span className="font-medium">assigned</span> issues, and matches them to a member by email — make sure each member&apos;s Linear email matches their email in poddaily.
          </p>
        </div>

        <form action={saveLinearSecretAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-5">
          <Field
            label="Signing secret (optional)"
            className="min-w-64 flex-1"
            hint={hasSecret ? "A signing secret is saved. Enter a new one to replace it." : "Paste Linear's webhook signing secret to verify incoming events."}
          >
            <Input type="password" name="secret" placeholder={hasSecret ? "••••••••••••" : "lin_wh_…"} autoComplete="off" />
          </Field>
          <Button type="submit" variant="outline">
            {hasSecret ? "Update secret" : "Save secret"}
          </Button>
        </form>
      </Card>

      {/* Unmatched Linear activity */}
      {issueCount > 0 ? (
        <Card className="reveal space-y-3" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center justify-between gap-2">
            <SectionTitle description="Linear activity is attributed to a member by email. Anyone here has activity we couldn't match — align their Linear email with their Slack/poddaily email so their closed issues show up.">
              Unmatched Linear people
            </SectionTitle>
            {unmatched.length > 0 ? <StatusPill tone="warning">{unmatched.length}</StatusPill> : null}
          </div>
          {unmatched.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              All received Linear activity is matched to a poddaily member.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {unmatched.map((u) => (
                <li key={u.email} className="flex items-center gap-3 bg-card px-3.5 py-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{u.name ?? u.email}</p>
                    <p className="truncate font-mono text-[11.5px] text-subtle-foreground">{u.email}</p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {u.issueCount} {u.issueCount === 1 ? "issue" : "issues"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {/* Coming soon */}
      <div className="reveal space-y-3" style={{ animationDelay: "80ms" }}>
        <SectionTitle>More integrations</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {COMING_SOON.map((it) => (
            <div key={it.name} className="rounded-xl border border-border bg-card p-4 opacity-75 shadow-xs">
              <div className="flex items-center justify-between">
                <Logo initial={it.initial} color={it.color} />
                <StatusPill tone="neutral">Coming soon</StatusPill>
              </div>
              <p className="mt-3 font-heading text-[14px] font-semibold tracking-tight text-foreground">{it.name}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{it.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="reveal flex items-center gap-1.5 text-[12.5px] text-subtle-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        Closed issues will appear in the standup check-in in an upcoming release.
      </p>
    </div>
  );
}
