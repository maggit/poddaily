import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarOff } from "lucide-react";
import { getRunDetail, listTeamRunDates } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
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
      <Link
        href={`/teams/${teamId}`}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to team
      </Link>
      <div className="reveal">
        <PageHeader
          eyebrow="Reports"
          title={detail.team.name}
          actions={detail.run ? <StatusPill tone={detail.run.status === "completed" ? "success" : "warning"}>{detail.run.status} · {detail.reported}/{detail.total}</StatusPill> : null}
        />
      </div>

      {dates.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => {
            const on = d.date === activeDate;
            return (
              <Link
                key={d.date}
                href={`/reports/${teamId}?date=${d.date}`}
                className={`rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors ${
                  on
                    ? "border-accent bg-accent-subtle text-accent"
                    : "border-border bg-card text-muted-foreground shadow-xs hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {d.date} · {d.reported}/{d.total}
              </Link>
            );
          })}
        </div>
      ) : null}

      {!detail.run ? (
        <div className="reveal">
          <EmptyState icon={CalendarOff} title={`No standup ran${date ? ` on ${date}` : " yet"}`} />
        </div>
      ) : (
        <div className="space-y-4">
          {detail.cards.map((c, i) => (
            <div key={c.slackUserId} className="reveal" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <ReportCard card={c} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
