"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

export const GITHUB_URL = "https://github.com/maggit/poddaily";
const THEME_KEY = "pd-landing-theme";

function tickButtonClass(primary: boolean) {
  return `inline-flex h-11 items-center px-5 text-sm font-medium tracking-tight transition-colors ${
    primary
      ? "border border-accent/60 bg-accent/10 text-foreground hover:bg-accent hover:text-accent-foreground"
      : "border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
  }`;
}

/* Blueprint-style CTA with corner registration marks. */
export function TickButton({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <span className="group relative inline-block">
      {(["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"] as const).map((pos) => (
        <span
          key={pos}
          aria-hidden
          className={`absolute ${pos} h-2 w-2 border-accent/70 transition-opacity ${
            pos.includes("top") ? "border-t" : "border-b"
          } ${pos.includes("left") ? "border-l" : "border-r"} ${
            primary ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      ))}
      {href.startsWith("/") ? (
        <Link href={href} className={tickButtonClass(primary)}>
          {children}
        </Link>
      ) : (
        <a href={href} className={tickButtonClass(primary)}>
          {children}
        </a>
      )}
    </span>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
    >
      {dark ? (
        /* sun */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        /* moon */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Shared chrome for the public marketing pages (`/` and `/install`): the `.landing`
 * theme scope, light/dark toggle (system default, persisted, `?theme=` override),
 * grain + glow backdrop, header nav, and footer.
 */
export function LandingShell({
  nav,
  children,
}: {
  nav: Array<{ href: string; label: string }>;
  children: React.ReactNode;
}) {
  const [dark, setDark] = useState(true);

  // Sync with the pre-hydration script below (?theme= override, else stored, else system).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("theme");
    const stored = q === "light" || q === "dark" ? q : localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") setDark(stored === "dark");
    else setDark(!window.matchMedia("(prefers-color-scheme: light)").matches);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  };

  return (
    <div
      id="pd-landing"
      suppressHydrationWarning
      className={`landing ${dark ? "dark" : ""} min-h-screen bg-background text-foreground antialiased transition-colors`}
    >
      {/* Apply the saved/system theme before first paint to avoid a flash. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q==="light"||q==="dark"?q:localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var e=document.getElementById("pd-landing");if(e){e.classList.toggle("dark",t==="dark")}}catch(_){}})();`,
        }}
      />

      <div className="landing-grain relative overflow-hidden">
        {/* turquoise glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-220px] h-[560px] w-[820px] -translate-x-1/2 rounded-full blur-[150px]"
          style={{ background: "var(--landing-glow)" }}
        />

        <div className="relative mx-auto max-w-5xl px-6">
          <header className="reveal flex items-center justify-between py-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.svg" alt="" width={36} height={36} unoptimized className="h-9 w-9" />
              <span className="font-heading text-lg font-bold tracking-tight">poddaily</span>
            </Link>
            <nav className="flex items-center gap-2.5">
              {nav.map((l) =>
                l.href.startsWith("/") ? (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                ) : (
                  <a
                    key={l.href}
                    href={l.href}
                    className="px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </a>
                )
              )}
              <ThemeToggle dark={dark} onToggle={toggle} />
            </nav>
          </header>

          {children}

          <footer className="space-y-2 border-t border-border py-8 font-mono text-[11px] text-subtle-foreground">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>
                poddaily — an open-source standup bot ·{" "}
                <a href={GITHUB_URL} className="underline underline-offset-2 transition-colors hover:text-foreground">
                  source on GitHub
                </a>{" "}
                ·{" "}
                <a
                  href={`${GITHUB_URL}/blob/main/LICENSE`}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  MIT license
                </a>
              </p>
              <p>
                Made with <span className="text-accent">♥</span> by Raquel Hernandez
              </p>
            </div>
            <p>this deployment is a private instance for internal team use</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
