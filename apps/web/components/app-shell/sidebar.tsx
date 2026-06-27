"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ListChecks, MessageSquare, Settings, Shield, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = { Users, ListChecks, MessageSquare, Settings, Shield };

export function Sidebar({ userName, isAdmin }: { userName?: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 flex-col border-r border-border bg-surface-muted p-3">
      <div className="flex items-center gap-2 px-2 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground">p</span>
        <span className="text-[15px] font-medium">poddaily</span>
      </div>
      <nav className="mt-2 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon];
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${active ? "bg-accent-subtle font-medium text-accent" : "text-muted-foreground hover:bg-muted"}`}>
              {Icon ? <Icon className="h-[17px] w-[17px]" /> : null}
              {item.label}
            </Link>
          );
        })}
        {isAdmin ? (
          (() => {
            const active = pathname === "/people" || pathname.startsWith("/people");
            return (
              <Link href="/people"
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${active ? "bg-accent-subtle font-medium text-accent" : "text-muted-foreground hover:bg-muted"}`}>
                <Shield className="h-[17px] w-[17px]" />
                People
              </Link>
            );
          })()
        ) : null}
      </nav>
      <div className="mt-auto flex items-center gap-2 border-t border-border px-2 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-medium text-accent-foreground">
          {(userName ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-xs text-muted-foreground">{userName ?? "Account"}</span>
      </div>
    </aside>
  );
}
