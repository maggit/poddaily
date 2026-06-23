import Link from "next/link";
import { getTodayOverview } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

export default async function ReportsPage() {
  const rows = await getTodayOverview();
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No standups configured yet. <Link href="/dashboard" className="text-accent">Go to Teams</Link>.
        </div>
      ) : (
        <DataTable head={<><Th>Team</Th><Th>Standup</Th><Th>Date</Th><Th>Status</Th><Th>Reported</Th><Th /></>}>
          {rows.map((r) => (
            <tr key={r.teamId} className="hover:bg-surface-muted">
              <Td><Link href={`/reports/${r.teamId}`} className="font-medium text-foreground hover:text-accent">{r.teamName}</Link><span className="ml-2 text-subtle-foreground">#{r.slackChannelName}</span></Td>
              <Td className="text-muted-foreground">{r.standupName}</Td>
              <Td className="text-muted-foreground">{r.run?.scheduledDate ?? "—"}</Td>
              <Td>{r.run ? <StatusPill tone={r.run.status === "completed" ? "success" : "warning"}>{r.run.status}</StatusPill> : <span className="text-subtle-foreground">No standup today</span>}</Td>
              <Td className="text-muted-foreground">{r.reported}/{r.total}</Td>
              <Td className="text-right"><Link href={`/reports/${r.teamId}`} className="text-accent">View →</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
