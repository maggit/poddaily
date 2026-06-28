import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  dashed = true,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border bg-card px-6 py-14 text-center shadow-xs ${
        dashed ? "border-dashed border-border" : "border-border"
      }`}
    >
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-subtle text-accent">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <h2 className="mt-4 font-heading text-[16px] font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
