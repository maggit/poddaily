import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunDetail, listTeamRunDates } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ReportCard } from "@/components/reports/report-card";

export default async function TeamReportsPage({
  params, searchParams,
}: { params: Promise<{ teamId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { teamId } = await params;
  const { date } = await searchParams;
  const [detail, dates] = await Promise.all([
    getRunDetail(teamId, date),
    listTeamRunDates(teamId),
  ]);
  if (!detail) notFound();
  const activeDate = detail.run?.scheduledDate;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${detail.team.name} — Reports`}
        actions={detail.run ? <StatusPill tone={detail.run.status === "completed" ? "success" : "warning"}>{detail.run.status} · {detail.reported}/{detail.total}</StatusPill> : null}
      />
      <Link href={`/teams/${teamId}`} className="text-[13px] text-accent hover:underline">← Back to team</Link>

      {dates.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => (
            <Link
              key={d.date}
              href={`/reports/${teamId}?date=${d.date}`}
              className={`rounded-full px-3 py-1 text-xs ${d.date === activeDate ? "bg-accent text-accent-foreground" : "bg-surface-muted text-muted-foreground hover:text-foreground"}`}
            >
              {d.date} · {d.reported}/{d.total}
            </Link>
          ))}
        </div>
      ) : null}

      {!detail.run ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No standup ran{date ? ` on ${date}` : " yet"}.
        </div>
      ) : (
        <div className="space-y-4">
          {detail.cards.map((c) => <ReportCard key={c.slackUserId} card={c} />)}
        </div>
      )}
    </div>
  );
}
