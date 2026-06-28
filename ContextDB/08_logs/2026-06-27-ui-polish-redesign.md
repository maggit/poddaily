# 2026-06-27 — UI polish redesign ("Crisp Product")

A design polish pass on the admin web app (`apps/web`), triggered by the owner: the UI looked
"clunky and un-styled." References provided: Clerk + Hex admin dashboards (Mobbin). Chosen
direction: **Crisp Product** — cool-white canvas, true-black ink, all-grotesk type, a single
sparing **cobalt** accent. Full system documented in
[design-direction.md → Polish pass 2026-06-27](../04_knowledge/design-direction.md#polish-pass--2026-06-27-crisp-product).

## Root-cause finding
`--font-sans` in `globals.css` was a circular self-reference (`--font-sans: var(--font-sans)`),
so Geist never applied and the whole app rendered in the system font stack — most of the
"un-styled" feel. Fixed by wiring `--font-sans → --font-geist-sans` and adding Schibsted Grotesk
as the display face (`--font-display` / `--font-heading`).

## Changes
**Foundation**
- `app/layout.tsx` — fixed font wiring; added Schibsted Grotesk; removed Instrument Serif.
- `app/globals.css` — re-pigmented `:root` + `.dark` (cobalt accent, off-white canvas, crisper
  borders); added `--shadow-xs/sm/card/md/lg` depth tokens + shadow tints; added `--accent-strong`;
  applied `--font-heading` to `h1–h3`; added `.reveal` load-reveal keyframe/utility (respects
  `prefers-reduced-motion`).

**New shared primitives**
- `components/ui/form.tsx` — `Field`, `Label`, `Input`, `Textarea`, `Select`, `Card`, `SectionTitle`.
- `components/ui/empty-state.tsx` — `EmptyState`.

**Primitives upgraded** — `button.tsx` (new `accent` variant; taller sizes), `data-table.tsx`
(elevation + hover), `status-pill.tsx` (dot + ring), `page-header.tsx` (eyebrow + description,
28px display title), `avatar.tsx` (ring + auto-scaled initials).

**Shell** — `app-shell/sidebar.tsx` (grouped Workspace/Manage, active accent bar, account card),
`app-shell/top-bar.tsx` (sticky/blur, **route-derived breadcrumb** — replaced hardcoded "Teams"
prop, ⌘K affordance); `(dashboard)/layout.tsx` updated to match.

**Pages** — Teams/dashboard (showcase: stat strip, empty state, hover-reveal, staggered reveals),
people, reports (index + `[teamId]`), teams/new, teams/`[id]`, teams/`[id]`/standup, and `/login`
(font-serif regression fixed; brand mark + ambient backdrop).

**Component refactors** to shared primitives — `teams/{create-team-form,add-member-form,member-table,
managers-section}`, `people/role-select`, `reports/report-card`, `standups/{standup-form,
question-editor,schedule-picker}`.

## Verification
- `pnpm typecheck` — clean. `pnpm lint` — clean (0 errors).
- Dev server boots; `/login` renders 200; full Tailwind CSS compiles (new tokens/utilities) with
  no errors. Authenticated screens **not** visually verified (needs live DB + Slack session).

## Follow-up (same day) — nav + loading/error UX
- Built the two missing nav pages: **`(dashboard)/standups/page.tsx`** (per-team schedule/status
  index with stat strip) and **`(dashboard)/settings/page.tsx`** (read-only account + role/access
  + sign-out). `/standups` and `/settings` no longer 404.
- Added route-group boundaries: **`loading.tsx`** (shell skeleton), **`error.tsx`** (client retry
  boundary), **`not-found.tsx`** (friendly 404 for `notFound()` on missing teams/reports).
- `pnpm typecheck` + `pnpm lint` clean.

## Follow-up 2 — mobile responsive + form error feedback
- **Mobile:** new client `components/app-shell/app-shell.tsx` owns drawer state; server
  `(dashboard)/layout.tsx` now just fetches `me` + passes `signOutAction` into it. `Sidebar` gained
  `className` + `onNavigate` props (static rail on `md+`, slide-in drawer on mobile with backdrop /
  Esc / scroll-lock / route-change close); `TopBar` gained a hamburger (`onMenu`, `md:hidden`).
  `DataTable` wraps the table in `overflow-x-auto` + `min-w-[640px]`; `main`/`TopBar` padding scales.
- **Form errors:** `components/ui/form.tsx` adds `ActionState`/`FormAction` + `FormError`. Create
  Team, Add Member, and Standup forms converted to `useActionState` — validation/save errors return
  state and render inline; submit buttons show pending/disabled; Add Member resets on success. The
  corresponding server actions (`teams/new`, `teams/[id]` addMember, `teams/[id]/standup` save) now
  return `{ error }` / `{ ok }` instead of throwing.
- `pnpm typecheck` + `pnpm lint` clean; dev boots, `/login` 200, no compile errors.

## Pending
See [design-direction.md → Still pending](../04_knowledge/design-direction.md#still-pending):
dark-mode toggle, ⌘K command palette, inline errors for quick toggle/select actions, richer report
visuals (participation bar / stats rail), branding (favicon/OG), and authenticated visual QA.
