import Link from "next/link";
import { revalidatePath } from "next/cache";
import { CheckCircle2, Info, AlertTriangle, ArrowRight, KeyRound, Trash2 } from "lucide-react";
import { encryptToken } from "@poddaily/shared";
import {
  getIntegrationSetting, countLinearActivity, upsertIntegrationSetting, countUnmatchedLinearAssignees,
  listIntegrationSecretMeta, addIntegrationSecret, removeIntegrationSecret, removeAllIntegrationSecrets,
} from "@poddaily/db";
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

function timeAgo(date: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function IntegrationsPage() {
  await requireAdmin();

  const webUrl = process.env.NEXTAUTH_URL ?? "";
  const payloadUrl = `${webUrl}/api/integrations/linear/webhook`;
  const linear = await getIntegrationSetting(db, "linear");
  const issueCount = await countLinearActivity(db);
  const unmatchedCount = issueCount > 0 ? await countUnmatchedLinearAssignees(db) : 0;
  const secrets = await listIntegrationSecretMeta(db, "linear");
  const disabled = Boolean(linear && linear.enabled === false);
  const hasSecret = secrets.length > 0;
  const needsSecret = !disabled && !hasSecret; // required: events are rejected without a secret
  const connected = !disabled && hasSecret;

  async function addLinearSecretAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const secret = String(fd.get("secret") ?? "").trim();
    if (!secret) return;
    const label = String(fd.get("label") ?? "").trim() || null;
    await addIntegrationSecret(db, "linear", label, encryptToken(secret, process.env.INTERNAL_API_SECRET ?? ""));
    revalidatePath("/integrations");
  }

  async function removeLinearSecretAction(fd: FormData) {
    "use server";
    await requireAdmin();
    await removeIntegrationSecret(db, String(fd.get("id") ?? ""));
    revalidatePath("/integrations");
  }

  async function disconnectLinearAction() {
    "use server";
    await requireAdmin();
    // Stop processing events (webhook honors enabled=false) and clear all signing secrets.
    await removeAllIntegrationSecrets(db, "linear");
    await upsertIntegrationSetting(db, "linear", { enabled: false });
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
              {disabled ? (
                <StatusPill tone="danger">Disconnected</StatusPill>
              ) : needsSecret ? (
                <StatusPill tone="warning">Action needed</StatusPill>
              ) : (
                <StatusPill tone="success">Connected</StatusPill>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Surface the issues you closed yesterday in your standup&apos;s &ldquo;Previously&rdquo; section.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[12px] tabular-nums text-subtle-foreground">
              {issueCount} {issueCount === 1 ? "issue" : "issues"} tracked
            </p>
            <p className="text-[11px] text-subtle-foreground">
              {linear?.lastEventAt ? `Last event ${timeAgo(linear.lastEventAt)}` : "No events received yet"}
            </p>
          </div>
        </div>

        {needsSecret ? (
          <div className="flex items-start gap-2 rounded-lg bg-warning-subtle p-3 text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-[13px] leading-relaxed">
              <span className="font-medium">Verification required.</span> Paste Linear&apos;s webhook
              signing secret below — until then, all incoming events are rejected so only Linear can post here.
            </p>
          </div>
        ) : null}

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
            <li>Copy the <span className="font-medium text-foreground">Signing secret</span> Linear shows and paste it into the field below — <span className="font-medium text-foreground">required</span>, or incoming events are rejected.</li>
          </ol>
          <p className="flex items-start gap-1.5 pt-1 text-[12.5px] text-subtle-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            poddaily only processes <span className="font-medium">assigned</span> issues, and matches them to a member by email — make sure each member&apos;s Linear email matches their email in poddaily.
          </p>
        </div>

        <div className="space-y-3 border-t border-border pt-5">
          <SectionTitle description="Each Linear webhook has its own signing secret. Add one per webhook you point here (e.g. one for all public teams, another scoped to specific private teams) — events are verified against any of them, and required.">
            Signing secrets
          </SectionTitle>

          {secrets.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {secrets.map((s) => (
                <li key={s.id} className="flex items-center gap-3 bg-card px-3.5 py-2.5">
                  <KeyRound className="h-4 w-4 shrink-0 text-subtle-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{s.label ?? "Webhook secret"}</p>
                    <p className="text-[11.5px] text-subtle-foreground">
                      Added {s.createdAt ? timeAgo(s.createdAt) : "—"}
                    </p>
                  </div>
                  <form action={removeLinearSecretAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      type="submit"
                      aria-label="Remove secret"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-danger-subtle hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}

          <form action={addLinearSecretAction} className="flex flex-wrap items-end gap-3">
            <Field label="Label" className="w-40">
              <Input name="label" placeholder="Public teams" autoComplete="off" />
            </Field>
            <Field label={secrets.length > 0 ? "Add another signing secret" : "Signing secret"} className="min-w-56 flex-1">
              <Input type="password" name="secret" placeholder="lin_wh_…" autoComplete="off" />
            </Field>
            <Button type="submit" variant={needsSecret ? "accent" : "outline"}>Add secret</Button>
          </form>
        </div>

        {connected ? (
          <form action={disconnectLinearAction} className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[12.5px] leading-relaxed text-subtle-foreground">
              Stop processing Linear events and remove all signing secrets. Also delete the webhook(s) in Linear.
            </p>
            <Button type="submit" variant="destructive" className="shrink-0">Disconnect</Button>
          </form>
        ) : null}

        {/* Compact unmatched summary → dedicated paginated page */}
        {issueCount > 0 ? (
          unmatchedCount > 0 ? (
            <Link
              href="/integrations/linear/unmatched"
              className="flex items-center gap-2.5 border-t border-border pt-4 text-[13px] transition-colors hover:text-foreground"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <span className="flex-1 text-muted-foreground">
                <span className="font-medium text-foreground">{unmatchedCount}</span> Linear{" "}
                {unmatchedCount === 1 ? "person has" : "people have"} activity we couldn&apos;t match to a member
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-accent">
                Review <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ) : (
            <p className="flex items-center gap-1.5 border-t border-border pt-4 text-[13px] text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              All received Linear activity is matched to a poddaily member.
            </p>
          )
        ) : null}
      </Card>

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
