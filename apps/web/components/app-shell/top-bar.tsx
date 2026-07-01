"use client";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";

const SECTION_LABELS: Record<string, string> = {
  dashboard: "Teams",
  teams: "Teams",
  reports: "Reports",
  standups: "Standups",
  settings: "Settings",
  people: "People",
  integrations: "Integrations",
};

function sectionFromPath(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  return SECTION_LABELS[seg] ?? "Teams";
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const section = sectionFromPath(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className="text-subtle-foreground">poddaily</span>
          <span className="text-border">/</span>
          <span className="text-foreground">{section}</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] text-subtle-foreground shadow-xs transition-colors hover:text-muted-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border border-border bg-surface-muted px-1 font-sans text-[10px] text-subtle-foreground sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
