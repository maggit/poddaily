export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-accent">{eyebrow}</p>
        ) : null}
        <h1 className="font-heading text-[28px] font-semibold leading-none tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-prose text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
