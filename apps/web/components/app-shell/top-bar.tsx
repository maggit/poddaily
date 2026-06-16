import { Search } from "lucide-react";

export function TopBar({ breadcrumb }: { breadcrumb: React.ReactNode }) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border px-5">
      <div className="text-[13px] text-muted-foreground">{breadcrumb}</div>
      <div className="flex items-center gap-3 text-subtle-foreground">
        <Search className="h-4 w-4" />
        <div className="h-6 w-6 rounded-full bg-border" />
      </div>
    </header>
  );
}
