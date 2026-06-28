const TONES = {
  success: "bg-success-subtle text-success-foreground ring-success/15",
  warning: "bg-warning-subtle text-warning-foreground ring-warning/15",
  danger: "bg-danger-subtle text-danger-foreground ring-danger/15",
  neutral: "bg-muted text-muted-foreground ring-border",
} as const;

const DOTS = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-subtle-foreground",
} as const;

export function StatusPill({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: keyof typeof TONES;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} /> : null}
      {children}
    </span>
  );
}
