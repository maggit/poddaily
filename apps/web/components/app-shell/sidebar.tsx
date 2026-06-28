"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ListChecks, MessageSquare, Settings, Shield, LogOut, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { Users, ListChecks, MessageSquare, Settings };

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

function NavLink({ href, icon: Icon, label, active, onNavigate }: { href: string; icon: LucideIcon; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
        active
          ? "bg-accent-subtle font-medium text-accent"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
      ) : null}
      <Icon className={`h-[17px] w-[17px] ${active ? "text-accent" : "text-subtle-foreground group-hover:text-foreground"}`} />
      {label}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-1.5 pt-4 text-[10.5px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
      {children}
    </p>
  );
}

export function Sidebar({ userName, isAdmin, signOutAction, className, onNavigate }: {
  userName?: string;
  isAdmin?: boolean;
  signOutAction?: (formData: FormData) => void | Promise<void>;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const workspace = NAV_ITEMS.filter((i) => i.href !== "/settings");
  const settings = NAV_ITEMS.find((i) => i.href === "/settings");

  return (
    <aside className={cn("flex w-64 flex-col border-r border-border bg-surface-muted/60 px-3 pb-3", className)}>
      <div className="flex items-center gap-2.5 px-2.5 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-semibold text-accent-foreground shadow-sm">
          p
        </span>
        <span className="font-heading text-[15px] font-semibold tracking-tight">poddaily</span>
      </div>

      <nav className="flex flex-1 flex-col">
        <SectionLabel>Workspace</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {workspace.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={ICONS[item.icon]}
              label={item.label}
              active={isActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>

        {isAdmin || settings ? <SectionLabel>Manage</SectionLabel> : null}
        <div className="flex flex-col gap-0.5">
          {isAdmin ? (
            <NavLink href="/people" icon={Shield} label="People" active={isActive(pathname, "/people")} onNavigate={onNavigate} />
          ) : null}
          {settings ? (
            <NavLink href={settings.href} icon={ICONS[settings.icon]} label={settings.label} active={isActive(pathname, settings.href)} onNavigate={onNavigate} />
          ) : null}
        </div>
      </nav>

      <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-card p-2 shadow-xs">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-foreground">
          {(userName ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium leading-tight text-foreground">{userName ?? "Account"}</p>
          <p className="truncate text-[11px] leading-tight text-subtle-foreground">{isAdmin ? "Admin" : "Member"}</p>
        </div>
        {signOutAction ? (
          <form action={signOutAction}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="flex h-7 w-7 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-[15px] w-[15px]" />
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
