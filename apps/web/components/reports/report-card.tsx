import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import type { ReportCard as ReportCardData } from "@/lib/reports";

const STATUS: Record<ReportCardData["status"], { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  completed: { tone: "success", label: "Reported" },
  in_progress: { tone: "neutral", label: "Pending" },
  timed_out: { tone: "danger", label: "Timed out" },
  absent: { tone: "neutral", label: "Yet to report" },
};

export function ReportCard({ card }: { card: ReportCardData }) {
  const s = STATUS[card.status];
  const muted = card.status !== "completed";
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-card transition-opacity ${muted ? "opacity-65" : ""}`}
    >
      <div className="flex items-center gap-3">
        <Avatar src={card.avatarUrl} name={card.displayName} size={38} />
        <div className="flex-1">
          <div className="font-medium text-foreground">{card.displayName}</div>
          {card.status === "completed" && card.reportedAt ? (
            <div className="text-xs text-subtle-foreground">{new Date(card.reportedAt).toLocaleString()}</div>
          ) : null}
        </div>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
      </div>
      {card.answers.length > 0 ? (
        <dl className="mt-4 space-y-3.5 border-t border-border pt-4">
          {card.answers.map((qa, i) => (
            <div key={i} className="space-y-1">
              <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">{qa.question}</dt>
              <dd className="whitespace-pre-line text-[13.5px] leading-relaxed text-foreground">{qa.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
