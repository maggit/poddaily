import Link from "next/link";
import { ArrowRight, ListChecks, Settings2 } from "lucide-react";
import { listTeams } from "@/lib/teams";
import { getStandup } from "@/lib/standups";
import { parseWeeklyCron, WEEKDAYS, type Question } from "@poddaily/shared";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function describeSchedule(cron: string): string {
  try {
    const { weekdays, hour, minute } = parseWeeklyCron(cron);
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const set = new Set(weekdays);
    let days: string;
    if (weekdays.length === 7) days = "Every day";
    else if (weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) days = "Mon–Fri";
    else days = WEEKDAYS.filter((d) => set.has(d.value)).map((d) => d.label).join(", ") || "—";
    return `${days} · ${time}`;
  } catch {
    return cron;
  }
}

function Stat({ icon: Icon, label, value, delay }: { icon: typeof ListChecks; label: string; value: number; delay: number }) {
  return (
    <div className="reveal rounded-xl border border-border bg-card p-4 shadow-card" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 text-subtle-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-medium uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-2 font-heading text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export default async function StandupsPage() {
  const teams = await listTeams();
  const standups = await Promise.all(teams.map((t) => getStandup(t.id)));
  const rows = teams.map((team, i) => ({ team, standup: standups[i] }));

  const configured = standups.filter(Boolean).length;
  const active = standups.filter((s) => s && s.isActive !== false).length;

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Workspace"
          title="Standups"
          description="Each team's standup schedule and status. Configure questions, timing, and messages per team."
        />
      </div>

      {teams.length === 0 ? (
        <div className="reveal">
          <EmptyState
            icon={ListChecks}
            title="No standups yet"
            description="Create a team first, then configure its standup."
            action={
              <Link href="/teams/new" className={cn(buttonVariants({ variant: "accent" }))}>
                Create team
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={ListChecks} label="Teams" value={teams.length} delay={60} />
            <Stat icon={Settings2} label="Configured" value={configured} delay={120} />
            <Stat icon={ListChecks} label="Active" value={active} delay={180} />
          </div>

          <div className="reveal" style={{ animationDelay: "220ms" }}>
            <DataTable head={<><Th>Team</Th><Th>Schedule</Th><Th>Questions</Th><Th>Status</Th><Th className="text-right" /></>}>
              {rows.map(({ team, standup }) => {
                const questionCount = standup ? (standup.questions as Question[]).length : 0;
                return (
                  <tr key={team.id} className="group hover:bg-surface-muted/60">
                    <Td>
                      <Link href={`/teams/${team.id}/standup`} className="font-medium text-foreground transition-colors hover:text-accent">
                        {team.name}
                      </Link>
                      <p className="text-[12px] text-subtle-foreground">#{team.slackChannelName}</p>
                    </Td>
                    <Td className="text-muted-foreground">
                      {standup ? describeSchedule(standup.scheduleCron) : <span className="text-subtle-foreground">—</span>}
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{standup ? questionCount : "—"}</Td>
                    <Td>
                      {!standup ? (
                        <StatusPill tone="neutral">Not configured</StatusPill>
                      ) : standup.isActive === false ? (
                        <StatusPill tone="neutral">Paused</StatusPill>
                      ) : (
                        <StatusPill tone="success">Active</StatusPill>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/teams/${team.id}/standup`}
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground opacity-0 transition-all group-hover:text-accent group-hover:opacity-100"
                      >
                        {standup ? "Configure" : "Set up"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
