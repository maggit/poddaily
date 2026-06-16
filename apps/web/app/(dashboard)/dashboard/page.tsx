import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Teams" />
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Team and standup management arrives next.{" "}
          <StatusPill tone="success">design system live</StatusPill>
        </p>
      </div>
    </div>
  );
}
