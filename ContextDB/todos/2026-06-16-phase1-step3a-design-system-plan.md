# Phase 1 — Step 3 (Part 1): Design System + App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realize the locked [design direction](../04_knowledge/design-direction.md) in `apps/web` — a single-source-of-truth theme, a dark premium `/login`, and a light Resend-style app shell — built so the whole UI can be **restyled later by editing tokens in one file**, not touching components.

**Architecture:** All design tokens are CSS variables in `apps/web/app/globals.css` (`:root` = light product theme; `.dark` scope = auth). Tailwind v4 `@theme inline` maps them to semantic utilities. Components consume **only** semantic classes (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-accent`, status tints) — no hardcoded colors — so reskinning = edit `globals.css`. A small set of reusable shell components (Sidebar, TopBar, PageHeader, StatusPill) localizes layout/polish.

**Tech Stack:** Next.js 15, Tailwind v4 + shadcn (already set up), Geist Sans/Mono (scaffold) + Instrument Serif (next/font), NextAuth (existing).

Source: [design-direction.md](../04_knowledge/design-direction.md) · build step 3 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md) · admin app per [admin-CRUD ADR](../03_decisions/2026-06-16-admin-crud-via-next-server.md).

> **Themability is a hard requirement (owner request):** every task must use semantic theme
> classes only. If an implementer is tempted to write a hex value or a one-off color in a
> component, that's a signal to add/use a token instead. The reviewer checks this.

---

## File Structure

```
apps/web/
├─ app/
│  ├─ globals.css            # ← THE theme: all tokens (light :root + .dark auth) + @theme map
│  ├─ layout.tsx             # fonts (Geist + Instrument Serif), light by default
│  ├─ login/
│  │  ├─ layout.tsx          # wraps login subtree in `.dark` scope
│  │  └─ page.tsx            # dark premium card (restyled)
│  └─ (dashboard)/
│     ├─ layout.tsx          # AppShell (sidebar + topbar), session guard
│     └─ dashboard/page.tsx  # placeholder inside shell, via PageHeader
├─ components/
│  ├─ app-shell/
│  │  ├─ sidebar.tsx         # nav + account chip
│  │  └─ top-bar.tsx         # breadcrumb slot + search + avatar
│  ├─ page-header.tsx        # page title + actions slot
│  └─ ui/
│     ├─ status-pill.tsx     # tinted status pill (reported/blocker/etc.)
│     └─ (existing shadcn: button.tsx, ...)
└─ lib/nav.ts                # sidebar nav config (single place to edit nav items)
```

Tokens live in one file; nav lives in one config; presentational components are small and
semantic. This is what makes later polish cheap.

---

### Task 1: Theme tokens (the single source of truth)

**Files:**
- Modify: `apps/web/app/globals.css`

Replace the color layer of `globals.css` with the poddaily tokens. Keep shadcn's structure
(`:root`, `.dark`, `@theme inline`, the `@custom-variant dark`). Use these values (from the
design direction). Keep any existing `@import "tailwindcss";`, base layer, and radius lines.

- [ ] **Step 1: Write the light (`:root`) + dark (`.dark`) tokens**

In `globals.css`, set the CSS variables (hex is fine; Tailwind v4 accepts them):
```css
:root {
  --radius: 0.75rem;

  --background: #ffffff;
  --surface-muted: #fafafa;
  --card: #ffffff;
  --card-foreground: #18181b;
  --popover: #ffffff;
  --popover-foreground: #18181b;

  --foreground: #18181b;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --subtle-foreground: #a1a1aa;

  --border: #e4e4e7;
  --input: #e4e4e7;
  --ring: #6366f1;

  --primary: #18181b;
  --primary-foreground: #ffffff;
  --secondary: #f4f4f5;
  --secondary-foreground: #18181b;
  --accent: #6366f1;
  --accent-foreground: #ffffff;
  --accent-subtle: #eef0ff;        /* tinted accent bg for active nav */

  --success: #16a34a;
  --success-subtle: #eaf3de;
  --success-foreground: #3b6d11;
  --warning: #f59e0b;
  --warning-subtle: #faeeda;
  --warning-foreground: #854f0b;
  --danger: #ef4444;
  --danger-subtle: #fcebeb;
  --danger-foreground: #a32d2d;

  --destructive: #ef4444;
}

/* Auth-only dark scope: any subtree with `.dark` (e.g. /login) flips to the dark theme. */
.dark {
  --background: #0a0a0a;
  --surface-muted: #161618;
  --card: #161618;
  --card-foreground: #fafafa;
  --popover: #161618;
  --popover-foreground: #fafafa;

  --foreground: #fafafa;
  --muted: #1c1c1f;
  --muted-foreground: #a1a1aa;
  --subtle-foreground: #52525b;

  --border: #27272a;
  --input: #27272a;
  --ring: #6366f1;

  --primary: #fafafa;
  --primary-foreground: #18181b;
  --secondary: #1c1c1f;
  --secondary-foreground: #fafafa;
  --accent: #6366f1;
  --accent-foreground: #ffffff;
  --accent-subtle: #1e1b4b;
}
```

- [ ] **Step 2: Map tokens to Tailwind utilities via `@theme inline`**

Ensure the `@theme inline { ... }` block maps each variable so utilities exist. Add the
poddaily-specific ones alongside shadcn's defaults:
```css
@theme inline {
  --color-background: var(--background);
  --color-surface-muted: var(--surface-muted);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent-subtle: var(--accent-subtle);
  --color-success: var(--success);
  --color-success-subtle: var(--success-subtle);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-subtle: var(--warning-subtle);
  --color-warning-foreground: var(--warning-foreground);
  --color-danger: var(--danger);
  --color-danger-subtle: var(--danger-subtle);
  --color-danger-foreground: var(--danger-foreground);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
```
Keep the existing `--font-sans`/`--font-mono` mappings if present.

- [ ] **Step 3: Verify utilities compile**

Temporarily add to `dashboard/page.tsx` a `<div className="bg-accent-subtle text-accent border border-border rounded-lg">test</div>`, run `pnpm --filter @poddaily/web build`. Expect success (utilities resolve). Then REMOVE the temporary div.

- [ ] **Step 4: Commit**
```bash
git add apps/web/app/globals.css
git commit -m "feat(web): poddaily theme tokens (single-source, light app + dark auth scope)"
```

---

### Task 2: Fonts — Geist (existing) + Instrument Serif (display)

**Files:**
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Load fonts and set light-by-default**

Update `layout.tsx`: keep the scaffold's Geist Sans/Mono; add Instrument Serif from
`next/font/google` exposing `--font-serif`; REMOVE the `dark` class from `<html>` (the app is
light by default; auth scopes dark itself).
```tsx
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif", subsets: ["latin"], weight: "400",
});

export const metadata = {
  title: "poddaily",
  description: "Self-hosted Slack standup admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} min-h-screen bg-background text-foreground antialiased`}>
        {children}
      </body>
    </html>
  );
}
```
If the scaffold imported Geist differently, preserve its import; only add Instrument Serif and the var wiring.

- [ ] **Step 2: Expose a serif display utility**

In `globals.css`, add the mapping (under `@theme inline`): `--font-serif: var(--font-serif);`
so `font-serif` utility uses Instrument Serif. (If shadcn already maps `--font-sans`/`--font-mono`, follow the same pattern.)

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @poddaily/web build`. Expect success.

- [ ] **Step 4: Commit**
```bash
git add apps/web/app/layout.tsx apps/web/app/globals.css
git commit -m "feat(web): load Instrument Serif display font; app light by default"
```

---

### Task 3: Login restyle (dark, premium)

**Files:**
- Create: `apps/web/app/login/layout.tsx`
- Modify: `apps/web/app/login/page.tsx`

- [ ] **Step 1: Scope the login subtree to dark** — `apps/web/app/login/layout.tsx`
```tsx
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark min-h-screen bg-background text-foreground">{children}</div>;
}
```

- [ ] **Step 2: Restyle the login page** — `apps/web/app/login/page.tsx`

Match the approved mockup (dark card, serif wordmark, Slack button). Use semantic classes only.
```tsx
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="font-serif text-4xl leading-none text-foreground">poddaily</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sign in to manage your team&apos;s standups.
        </p>
        <form
          className="mt-7"
          action={async () => {
            "use server";
            const { signIn } = await import("@/auth");
            await signIn("slack", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full gap-2">
            Sign in with Slack
          </Button>
        </form>
        <p className="mt-5 text-xs text-subtle-foreground">Internal engineers only</p>
      </div>
    </main>
  );
}
```
(If the shadcn `Button` `secondary` variant doesn't read well on dark, use the default and rely on the dark `--secondary` token — keep it semantic, no hardcoded colors.)

- [ ] **Step 3: Verify** — `pnpm --filter @poddaily/web build` succeeds; dev server `/login` returns 200 and renders dark.
```bash
pnpm --filter @poddaily/web dev > /tmp/s3dev.log 2>&1 &
sleep 9
curl -sS -o /dev/null -w 'login %{http_code}\n' http://localhost:3000/login
kill %1 2>/dev/null
```

- [ ] **Step 4: Commit**
```bash
git add apps/web/app/login
git commit -m "feat(web): restyle login — dark premium card with serif wordmark"
```

---

### Task 4: App shell — sidebar + top bar (light)

**Files:**
- Create: `apps/web/lib/nav.ts`, `apps/web/components/app-shell/sidebar.tsx`, `apps/web/components/app-shell/top-bar.tsx`, `apps/web/components/page-header.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Nav config (single place to edit nav)** — `apps/web/lib/nav.ts`
```ts
export interface NavItem { label: string; href: string; icon: string; }

// `icon` is a lucide-react icon name (shadcn ships lucide-react).
export const NAV_ITEMS: NavItem[] = [
  { label: "Teams", href: "/dashboard", icon: "Users" },
  { label: "Standups", href: "/standups", icon: "ListChecks" },
  { label: "Reports", href: "/reports", icon: "MessageSquare" },
  { label: "Settings", href: "/settings", icon: "Settings" },
];
```

- [ ] **Step 2: Sidebar** — `apps/web/components/app-shell/sidebar.tsx`

A client component highlighting the active route. Use lucide-react icons dynamically. Semantic classes only; active = `bg-accent-subtle text-accent`.
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ListChecks, MessageSquare, Settings, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = { Users, ListChecks, MessageSquare, Settings };

export function Sidebar({ userName }: { userName?: string }) {
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
```
If `lucide-react` is not installed (the scaffold used Base UI for shadcn), install it: `pnpm --filter @poddaily/web add lucide-react`. Report if you had to.

- [ ] **Step 3: Top bar** — `apps/web/components/app-shell/top-bar.tsx`
```tsx
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
```

- [ ] **Step 4: Page header (reusable title + actions)** — `apps/web/components/page-header.tsx`
```tsx
export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-[22px] font-medium tracking-tight">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: Wire the shell into the dashboard layout** — `apps/web/app/(dashboard)/layout.tsx`
```tsx
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userName={session.user?.name ?? undefined} />
      <div className="flex flex-1 flex-col">
        <TopBar breadcrumb={<span>Home <span className="text-border">/</span> <span className="text-foreground">Teams</span></span>} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify** — `pnpm --filter @poddaily/web build` succeeds.

- [ ] **Step 7: Commit**
```bash
git add apps/web/lib/nav.ts apps/web/components apps/web/app/(dashboard)/layout.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): light app shell — sidebar, top bar, page header"
```

---

### Task 5: StatusPill primitive + dashboard placeholder in the shell

**Files:**
- Create: `apps/web/components/ui/status-pill.tsx`
- Modify: `apps/web/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: StatusPill** — `apps/web/components/ui/status-pill.tsx`

A themable tinted pill driven by a `tone` prop mapping to semantic tokens.
```tsx
const TONES = {
  success: "bg-success-subtle text-success-foreground",
  warning: "bg-warning-subtle text-warning-foreground",
  danger: "bg-danger-subtle text-danger-foreground",
  neutral: "bg-muted text-muted-foreground",
} as const;

export function StatusPill({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Dashboard placeholder using the shell + PageHeader + a pill** — `apps/web/app/(dashboard)/dashboard/page.tsx`
```tsx
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/ui/status-pill";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Teams" />
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Team and standup management arrives next. <StatusPill tone="success">design system live</StatusPill>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify** — build + dev: `/dashboard` (when authed) renders the light shell; `/login` is dark. Since auth gates `/dashboard`, verify the layout compiles and the redirect still works signed-out (`/dashboard` → `/login`).
```bash
pnpm --filter @poddaily/web dev > /tmp/s3dev2.log 2>&1 &
sleep 9
curl -sS -o /dev/null -w 'login %{http_code}\n' http://localhost:3000/login
curl -sS -o /dev/null -w 'dash %{url_effective} %{http_code}\n' -L http://localhost:3000/dashboard
kill %1 2>/dev/null
```
Expect login 200; dashboard redirects to /login.

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/ui/status-pill.tsx "apps/web/app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(web): StatusPill primitive + dashboard in the app shell"
```

---

### Task 6: Theming docs + verification

**Files:**
- Modify: `apps/web/README.md` (or create a short THEMING section), `ContextDB/04_knowledge/design-direction.md`
- Create: `ContextDB/08_logs/2026-06-16-step3a-design-system-build.md`

- [ ] **Step 1: Add a "Theming / how to restyle" note**

Append a short section to `ContextDB/04_knowledge/design-direction.md` documenting the
restyle path: all tokens live in `apps/web/app/globals.css` (`:root` light, `.dark` auth);
components use semantic classes only; to reskin, edit token values (e.g. change `--accent`);
the nav lives in `apps/web/lib/nav.ts`. Reskinning requires no component edits.

- [ ] **Step 2: Run the full suite** — `pnpm test` (existing 11 pass — design system is presentational, no test regressions) and `pnpm --filter @poddaily/web build`.

- [ ] **Step 3: Build log** — `ContextDB/08_logs/2026-06-16-step3a-design-system-build.md`
```markdown
# 2026-06-16 — Step 3 Part 1 Build: Design System + App Shell

Applied the locked design direction to apps/web: single-source theme tokens in globals.css
(light product `:root` + scoped `.dark` auth), Instrument Serif display font, restyled dark
premium /login, and a light Resend-style app shell (Sidebar, TopBar, PageHeader) with the
indigo accent. Added a themable StatusPill primitive and nav config (lib/nav.ts).

Themability: components use only semantic theme classes; reskinning = edit globals.css tokens.

## Verification
- pnpm test: 11 pass (presentational change, no regressions).
- pnpm --filter @poddaily/web build: success.
- dev: /login dark (200); /dashboard light shell, redirects to /login when signed out.

Next: Step 3 Part 2 — team + member CRUD (teams list, create-team form, member table) via
Next server-side against @poddaily/db (smoke:team).
```

- [ ] **Step 4: Commit**
```bash
git add ContextDB ChangeLog 2>/dev/null; git add ContextDB apps/web/README.md 2>/dev/null
git commit -m "docs: theming guide + step 3 part 1 build log"
```

---

## Verification (end of Part 1)

- [ ] `pnpm test` passes (11, unchanged).
- [ ] `pnpm --filter @poddaily/web build` succeeds.
- [ ] `/login` renders dark/premium (serif wordmark); `/dashboard` (authed) renders the light shell with sidebar + top bar; signed-out `/dashboard` → `/login`.
- [ ] All new components use semantic theme classes only — no hardcoded colors. Changing `--accent` in `globals.css` reskins the accent everywhere.

This produces the realized design direction as a reskinnable foundation — the base for Part 2
(team & member CRUD).
