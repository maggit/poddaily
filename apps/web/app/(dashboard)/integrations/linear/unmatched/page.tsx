import Link from "next/link";
import { ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { listUnmatchedLinearAssignees, countUnmatchedLinearAssignees } from "@poddaily/db";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 25;

function Pager({ disabled, href, dir }: { disabled: boolean; href: string; dir: "prev" | "next" }) {
  const label = dir === "prev" ? "Previous" : "Next";
  const icon = dir === "prev" ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />;
  const cls = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[12.5px] font-medium shadow-xs";
  const body = (
    <>
      {dir === "prev" ? icon : null}
      {label}
      {dir === "next" ? icon : null}
    </>
  );
  if (disabled) return <span className={`${cls} cursor-not-allowed text-subtle-foreground opacity-60`}>{body}</span>;
  return <Link href={href} className={`${cls} text-foreground transition-colors hover:bg-muted`}>{body}</Link>;
}

export default async function UnmatchedLinearPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  await requireAdmin();
  const { offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);

  const [rows, total] = await Promise.all([
    listUnmatchedLinearAssignees(db, { limit: PAGE_SIZE, offset }),
    countUnmatchedLinearAssignees(db),
  ]);
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + rows.length;
  const hasPrev = offset > 0;
  const hasNext = last < total;

  return (
    <div className="space-y-6">
      <Link
        href="/integrations"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to integrations
      </Link>
      <div className="reveal">
        <PageHeader
          eyebrow="Linear"
          title="Unmatched people"
          description="These Linear assignees have activity but no poddaily member with a matching email, so their closed issues won't appear in standups. Align their Linear email with their Slack/poddaily email to fix."
        />
      </div>

      {total === 0 ? (
        <div className="reveal">
          <EmptyState icon={CheckCircle2} title="Everyone is matched" description="All received Linear activity maps to a poddaily member." />
        </div>
      ) : (
        <>
          <Card className="reveal overflow-hidden p-0">
            <ul className="divide-y divide-border">
              {rows.map((u) => (
                <li key={u.email} className="flex items-center gap-3 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-foreground">{u.name ?? u.email}</p>
                    <p className="truncate font-mono text-[11.5px] text-subtle-foreground">{u.email}</p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {u.issueCount} {u.issueCount === 1 ? "issue" : "issues"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
            <span className="tabular-nums">{first}–{last} of {total}</span>
            <div className="flex gap-2">
              <Pager disabled={!hasPrev} dir="prev" href={`/integrations/linear/unmatched?offset=${Math.max(0, offset - PAGE_SIZE)}`} />
              <Pager disabled={!hasNext} dir="next" href={`/integrations/linear/unmatched?offset=${offset + PAGE_SIZE}`} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
