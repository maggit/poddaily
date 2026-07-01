import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Return value of a form server action wired through `useActionState`. */
export type ActionState = { error?: string; ok?: boolean } | null;
export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-subtle px-3 py-2.5 text-[13px] font-medium text-danger-foreground"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Shared control styling — crisp white field, cobalt focus ring. */
export const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-[box-shadow,border-color] placeholder:text-subtle-foreground focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

export function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[13px] font-medium text-foreground">
      {children}
      {required ? <span className="text-danger"> *</span> : null}
    </span>
  );
}

export function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <Label required={required}>{label}</Label>
      {children}
      {hint ? <span className="block text-xs text-subtle-foreground">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "h-auto py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClass, "pr-8", className)} {...props} />;
}

export function Card({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6 shadow-card", className)} style={style}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="font-heading text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
      {description ? <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}
