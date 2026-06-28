import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { getTodayOverview } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export default async function ReportsPage() {
  const rows = await getTodayOverview();
  return (
    <div className="space-y-7">
      <div className="reveal">
        <PageHeader
          eyebrow="Workspace"
          title="Reports"
          description="Today's standup status across every team."
        />
      </div>
      {rows.length === 0 ? (
        <div className="reveal">
          <EmptyState
            icon={MessageSquare}
            title="No standups configured"
            description="Configure a standup on a team to start collecting reports."
            action={
              <Link href="/dashboard" className={cn(buttonVariants({ variant: "accent" }))}>
                Go to Teams
              </Link>
            }
          />
        </div>
      ) : (
        <div className="reveal" style={{ animationDelay: "80ms" }}>
          <DataTable head={<><Th>Team</Th><Th>Standup</Th><Th>Date</Th><Th>Status</Th><Th>Reported</Th><Th className="text-right" /></>}>
            {rows.map((r) => (
              <tr key={r.teamId} className="group hover:bg-surface-muted/60">
                <Td>
                  <Link href={`/reports/${r.teamId}`} className="font-medium text-foreground transition-colors hover:text-accent">{r.teamName}</Link>
                  <p className="text-[12px] text-subtle-foreground">#{r.slackChannelName}</p>
                </Td>
                <Td className="text-muted-foreground">{r.standupName}</Td>
                <Td className="tabular-nums text-muted-foreground">{r.run?.scheduledDate ?? "—"}</Td>
                <Td>{r.run ? <StatusPill tone={r.run.status === "completed" ? "success" : "warning"}>{r.run.status}</StatusPill> : <span className="text-[12.5px] text-subtle-foreground">No standup today</span>}</Td>
                <Td className="tabular-nums text-muted-foreground">{r.reported}/{r.total}</Td>
                <Td className="text-right">
                  <Link href={`/reports/${r.teamId}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground opacity-0 transition-all group-hover:text-accent group-hover:opacity-100">
                    View
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
