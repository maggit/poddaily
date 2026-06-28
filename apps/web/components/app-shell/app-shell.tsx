"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export function AppShell({
  userName,
  isAdmin,
  signOutAction,
  children,
}: {
  userName?: string;
  isAdmin?: boolean;
  signOutAction?: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // close the drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // lock body scroll + close on Escape while the drawer is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* desktop rail */}
      <Sidebar
        userName={userName}
        isAdmin={isAdmin}
        signOutAction={signOutAction}
        className="hidden md:flex"
      />

      {/* mobile drawer + backdrop */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <Sidebar
        userName={userName}
        isAdmin={isAdmin}
        signOutAction={signOutAction}
        onNavigate={() => setOpen(false)}
        className={`fixed inset-y-0 left-0 z-50 shadow-lg transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
