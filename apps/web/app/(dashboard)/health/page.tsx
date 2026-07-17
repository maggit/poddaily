import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowRight, HeartPulse } from "lucide-react";
import { getStandupHealth, type StandupHealthRow } from "@/lib/health";
import { getStandup } from "@/lib/standups";
import { enqueueStandupTrigger } from "@/lib/queue";
import { requireUser, requireTeamEdit, canEditTeam } from "@/lib/authz";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { TriggerNowButton } from "@/components/standups/trigger-now-button";
import type { ActionState } from "@/components/ui/form";

export const dynamic = "force-dynamic";

const STATE_PILL: Record<StandupHealthRow["state"], { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  completed: { tone: "success", label: "Completed today" },
  running: { tone: "warning", label: "Running" },
  missed: { tone: "danger", label: "Did not trigger" },
  waiting: { tone: "neutral", label: "Waiting" },
  paused: { tone: "neutral", label: "Paused" },
  unconfigured: { tone: "neutral", label: "Not configured" },
};

function formatNextRun(at: Date | null, tz: string | null): string {
  if (!at || !tz) return "—";
  return new Intl.DateTimeFormat("en", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).format(at);
}

function LastRunCell({ row }: { row: StandupHealthRow }) {
  const run = row.lastRun;
  if (!run) return <span className="text-subtle-foreground">Never ran</span>;
  const pending = run.dmSent - run.completed - run.timedOut;
  return (
    <div className="space-y-0.5">
      <p className="font-medium tabular-nums text-foreground">
        {run.isToday ? "Today" : run.date}
        <span className="ml-2 font-normal text-muted-foreground">
          DMs sent {run.dmSent}/{row.reporters}
        </span>
      </p>
      <p className="text-[12px] tabular-nums text-subtle-foreground">
        {run.completed} reported
        {pending > 0 ? ` · ${pending} pending` : ""}
        {run.timedOut > 0 ? ` · ${run.timedOut} timed out` : ""}
        {run.dmSent < row.reporters ? ` · ${row.reporters - run.dmSent} never DMed` : ""}
      </p>
    </div>
  );
}

export default async function HealthPage() {
  const user = await requireUser();
  const rows = await getStandupHealth();
  const editable = await Promise.all(rows.map((r) => canEditTeam(user, r.teamId)));

  async function triggerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
    "use server";
    const teamId = String(fd.get("teamId") ?? "");
    if (!teamId) return { error: "Missing team." };
    await requireTeamEdit(teamId);
    const standup = await getStandup(teamId);
    if (!standup) return { error: "No standup configured." };
    if (standup.isActive === false) return { error: "Standup is paused." };
    try {
      await enqueueStandupTrigger(standup.id, { force: true });
    } catch {
      return { error: "Queue unreachable." };
    }
    revalidatePath("/health");
    return { ok: true };
  }

  const missed = rows.filter((r) => r.state === "missed").length;

  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Workspace"
          title="Standup health"
          description="Whether each team's standup fired, who got their DM, and who reported. Trigger a standup manually if a run was missed."
          actions={missed > 0 ? <StatusPill tone="danger">{missed} did not trigger</StatusPill> : null}
        />
      </div>

      {rows.length === 0 ? (
        <div className="reveal">
          <EmptyState icon={HeartPulse} title="No teams yet" description="Create a team and configure its standup to see health here." />
        </div>
      ) : (
        <div className="reveal" style={{ animationDelay: "80ms" }}>
          <DataTable
            head={<><Th>Team</Th><Th>Status</Th><Th>Last run</Th><Th>Next run</Th><Th className="text-right">Actions</Th></>}
          >
            {rows.map((row, i) => {
              const pill = STATE_PILL[row.state];
              return (
                <tr key={row.teamId} className="group hover:bg-surface-muted/60">
                  <Td>
                    <Link href={`/teams/${row.teamId}/standup`} className="font-medium text-foreground transition-colors hover:text-accent">
                      {row.teamName}
                    </Link>
                    <p className="text-[12px] text-subtle-foreground">
                      #{row.slackChannelName}
                      {row.standupName ? ` · ${row.standupName}` : ""}
                    </p>
                  </Td>
                  <Td><StatusPill tone={pill.tone}>{pill.label}</StatusPill></Td>
                  <Td><LastRunCell row={row} /></Td>
                  <Td className="text-muted-foreground">
                    {row.state === "paused" || row.state === "unconfigured" ? "—" : formatNextRun(row.nextRunAt, row.scheduleTz)}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      {editable[i] && row.standupId && row.isActive ? (
                        <TriggerNowButton action={triggerAction} teamId={row.teamId} />
                      ) : null}
                      <Link
                        href={`/reports/${row.teamId}`}
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-accent"
                      >
                        Reports
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </div>
      )}
    </div>
  );
}
