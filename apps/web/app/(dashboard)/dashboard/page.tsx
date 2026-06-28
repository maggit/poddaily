import Link from "next/link";
import { ArrowRight, Layers, UserRound, Boxes, Plus } from "lucide-react";
import { listTeams, listMembers } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

function Stat({ icon: Icon, label, value, delay }: { icon: typeof Layers; label: string; value: number; delay: number }) {
  return (
    <div
      className="reveal rounded-xl border border-border bg-card p-4 shadow-card"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 text-subtle-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-2 font-heading text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export default async function TeamsPage() {
  const teams = await listTeams();
  const counts = await Promise.all(teams.map((t) => listMembers(t.id).then((m) => m.length)));
  const totalMembers = counts.reduce((a, b) => a + b, 0);
  const tribes = new Set(teams.map((t) => t.tribe).filter(Boolean)).size;

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Workspace"
          title="Teams"
          description="Every team running a daily standup, with its Slack channel and roster."
          actions={
            <Link href="/teams/new" className={cn(buttonVariants({ variant: "accent", size: "lg" }))}>
              <Plus className="h-4 w-4" />
              Create team
            </Link>
          }
        />
      </div>

      {teams.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={Layers} label="Teams" value={teams.length} delay={60} />
          <Stat icon={UserRound} label="Members" value={totalMembers} delay={120} />
          <Stat icon={Boxes} label="Tribes" value={tribes} delay={180} />
        </div>
      ) : null}

      {teams.length === 0 ? (
        <div className="reveal flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-subtle text-accent">
            <Layers className="h-6 w-6" />
          </div>
          <h2 className="mt-4 font-heading text-[17px] font-semibold tracking-tight">No teams yet</h2>
          <p className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">
            Create your first team to connect a Slack channel and start collecting daily standups.
          </p>
          <Link href="/teams/new" className={cn(buttonVariants({ variant: "accent", size: "lg" }), "mt-5")}>
            <Plus className="h-4 w-4" />
            Create team
          </Link>
        </div>
      ) : (
        <div className="reveal" style={{ animationDelay: "220ms" }}>
          <DataTable head={<><Th>Team</Th><Th>Tribe</Th><Th>Members</Th><Th>Status</Th><Th className="text-right" /></>}>
            {teams.map((t, i) => (
              <tr key={t.id} className="group hover:bg-surface-muted/60">
                <Td>
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-[12px] font-semibold uppercase text-muted-foreground">
                      {t.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <Link href={`/teams/${t.id}`} className="font-medium text-foreground transition-colors hover:text-accent">
                        {t.name}
                      </Link>
                      <p className="truncate text-[12px] text-subtle-foreground">#{t.slackChannelName}</p>
                    </div>
                  </div>
                </Td>
                <Td className="text-muted-foreground">{t.tribe ?? "—"}</Td>
                <Td className="tabular-nums text-muted-foreground">{counts[i]}</Td>
                <Td>
                  {counts[i] > 0 ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Empty</StatusPill>
                  )}
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/teams/${t.id}`}
                    className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:text-accent group-hover:opacity-100"
                  >
                    Manage
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </div>
  );
}
