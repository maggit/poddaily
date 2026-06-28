# Design Direction

The visual + interaction system for poddaily's admin UI. This is the **source of truth** for
every UI build step. It synthesizes three references the owner provided:

- **Resend** (via Mobbin) — the *visual language*: premium, calm, high-contrast. A deliberate
  **dark, serif-accented auth/marketing** surface and a **light, clean product app** (icon
  sidebar, hairline-bordered data tables, status pills, solid-black primary buttons, generous
  whitespace, mono for code/IDs).
- **Steady / Status Hero** — the *standup domain patterns*: the check-in **feed**
  (Next / Previously, activity rollups, reactions), the right-rail **Stats** (Participation,
  Intentions met, Blockers, Feeling as colored progress bars), and the **Roster** (avatars
  with colored status rings). Indigo/violet accent, quick calm tab transitions.
- **The original PRD reference screenshots** — the *information layout*: participation bar with
  reporter avatars (reported vs not), the member **permission table** (View/Report/Edit),
  the **schedule picker** (weekday chips + time + tz), the **question editor**.

**Core principle:** Resend's restraint and polish, carrying Steady's standup-native components,
laid out with the reference admin information density.

> ⚠️ **Updated 2026-06-27 — "Crisp Product" polish pass.** The accent, type, elevation, and
> motion decisions below were revised after a Clerk/Hex-referenced redesign. The sections from
> here to "Provenance" are the **original 2026-06-16 direction** and are kept for history; where
> they conflict with the current system, **[Polish pass — 2026-06-27](#polish-pass--2026-06-27-crisp-product) at the
> bottom of this file is authoritative.** Headline deltas: indigo `#6366F1` → cobalt `#2D5BFF`;
> Instrument Serif display → Schibsted Grotesk (all-grotesk, no serif); flat/no-shadow → layered
> depth tokens; added staggered load-reveal motion.

## Theme split (decided)

- **Auth / marketing (`/login`)** → **dark**, premium, serif display moment.
- **Admin product (everything behind login)** → **light**, Resend-style.

## Color

### Light app (product)
| Token | Value | Use |
|---|---|---|
| `--background` | `#FFFFFF` | page |
| `--surface-muted` | `#FAFAFA` | secondary panels, table header, sidebar |
| `--card` | `#FFFFFF` | cards, table body |
| `--border` | `#E4E4E7` (zinc-200) | hairline borders, dividers |
| `--foreground` | `#18181B` (zinc-900) | primary text |
| `--muted-foreground` | `#71717A` (zinc-500) | secondary text |
| `--subtle-foreground` | `#A1A1AA` (zinc-400) | tertiary / captions |
| `--primary` | `#18181B` | solid primary buttons (white text) — Resend |
| `--accent` | `#6366F1` (indigo-500) | active nav, links, focus rings, highlights — Steady-flavored |
| `--accent-foreground` | `#FFFFFF` | text on accent |

### Dark auth (`/login`)
| Token | Value | Use |
|---|---|---|
| `--background` | `#0A0A0A` | near-black page, optional subtle radial/grayscale gradient |
| `--card` | `#161618` | centered auth card |
| `--border` | `#27272A` | hairline on dark |
| `--foreground` | `#FAFAFA` | text |
| `--muted-foreground` | `#A1A1AA` | subtext |
| button | `#1C1C1F` bg + `#2A2A2E` border | refined dark button (Resend "Confirm account" style) |

### Semantic / status (both themes, tinted)
| Meaning | Color | Pill (light) | Avatar ring |
|---|---|---|---|
| Reported / checked-in / positive | green `#16A34A` | `bg-green-50 text-green-700` | green |
| Blocker / negative | red `#EF4444` | `bg-red-50 text-red-700` | red |
| Pending / not reported | gray `#71717A` | `bg-zinc-100 text-zinc-600` | gray |
| Info / neutral status | blue `#3B82F6` | `bg-blue-50 text-blue-700` | — |
| Warning / OOO | amber `#F59E0B` | `bg-amber-50 text-amber-700` | amber |

Stats bars (Participation/Blockers/Feeling) use these semantic colors as filled progress
tracks on a light track (`#F1F1F3`), mirroring Steady.

## Typography

- **UI sans:** **Geist Sans** (already shipped by the Next scaffold) — Resend-like geometric sans. Body 14px, small 13px, caption 12px.
- **Mono:** **Geist Mono** — cron expressions, IDs, channel handles, code.
- **Display serif:** an elegant serif for big moments only (the `/login` headline, optional page heroes) — **Instrument Serif** (or `Newsreader`; Georgia as fallback). Mirrors Resend's "Email for developers" headline.
- **Scale:** page title 28–30px / 600; section 18–20px / 600; card title 15–16px / 600; body 14px / 400; label 13px / 500 uppercase-tracked for table headers and metadata.

## Shape, spacing, elevation

- 8px base grid; generous whitespace (Resend is airy).
- Radius: cards/inputs `12px` (rounded-xl), buttons `8px`, pills full, avatars full.
- Borders do the work — **1px hairline borders**, minimal/no shadows (flat Resend look). A
  faint shadow only on overlays/menus/modals.
- Focus: 2px `--accent` ring with offset.

## Layout — app shell (light)

```
┌────────────┬───────────────────────────────────────────────┐
│  sidebar   │  top bar: page context · search · status · me │
│  (240px)   ├───────────────────────────────────────────────┤
│  ▸ Teams   │  Page Title (28–30px)                          │
│  ▸ ...     │  ── content: tables / cards / feed ──          │
│            │                                                │
│  account   │                                                │
└────────────┴───────────────────────────────────────────────┘
```
- **Sidebar:** light (`--surface-muted`), icon + label nav, account switcher with avatar at
  top or bottom. Active item = `--accent` text/icon + subtle accent-tinted pill background.
- **Top bar:** breadcrumb/page context left; search, a status affordance (e.g. workspace),
  and the signed-in avatar menu right (Resend pattern).
- **Content:** max-width ~1100px, large page title, then the page body.

## Components (mapped to poddaily)

- **Data table** (teams list, member table): `--surface-muted` header with 12–13px tracked
  uppercase labels, hairline row dividers, row hover `#FAFAFA`, trailing `…` action menu,
  status pills inline. (Resend Emails table.)
- **Status pill:** tinted bg + colored text per the semantic table.
- **Avatar + status ring:** roster/participants; ring color = report status. (Steady Roster.)
- **Participation bar:** horizontal track, reporter avatars clustered (reported left,
  not-reported right), % label — the reference Insights pattern in this palette.
- **Stats rail:** stacked labeled colored progress bars (Participation, Blockers, Feeling) —
  Steady right rail.
- **Buttons:** primary = solid `--primary` (black) / white text; secondary = white + border;
  ghost = text-only; destructive = red. Pills/rounded-md.
- **Forms:** labeled fields, hairline inputs, accent focus ring. Includes the **schedule
  picker** (weekday chips M/T/W/Th/F, time input, tz dropdown) and the **question editor**
  (draggable rows, inline edit, add/delete).
- **Feed card** (reports/timeline, later steps): avatar + name + timestamp, Next/Previously or
  Q&A blocks, activity rollups, 👍 reactions, Comment affordance. (Steady check-in card.)
- **Login (dark):** centered card on near-black, serif "poddaily" headline + muted subtext,
  "Sign in with Slack" refined dark button. Optional subtle grayscale gradient backdrop.

## Motion

Calm and quick (Steady-like). 150–200ms ease for hover, tab/route content fade-slide,
menu/modal open. Nothing bouncy; restraint over flourish.

## Implementation notes

- Tailwind + shadcn (already set up). Encode these as CSS variables in `globals.css` for the
  light app; scope the dark auth tokens to the `/login` route (or a `.auth-dark` wrapper) so
  the product stays light while auth stays dark.
- Geist Sans/Mono come from the scaffold; add the display serif (Instrument Serif) via
  `next/font`.
- **Brand accent: indigo `#6366F1`** (Steady-flavored) — **decided & signed off 2026-06-16**.
  Used sparingly for active nav, links, focus rings, and key highlights; semantic status
  colors (green/amber/red) carry meaning on top.

## Theming — how to restyle (single-file change)

The UI is built to be reskinned without touching components:

- **All tokens live in one file:** `apps/web/app/globals.css`. `:root` = the light product
  theme; the `.dark` scope = the auth/login theme. Values are plain hex.
- **Components use only semantic classes** — `bg-background`, `text-muted-foreground`,
  `border-border`, `bg-primary`, `text-accent`, `bg-accent-subtle`, and the status families
  (`bg-success-subtle`/`text-success-foreground`, etc.). No component hardcodes a color.
- **To reskin:** edit the token values in `globals.css`. Example: change `--accent` from
  `#6366f1` to another hue and every active nav item, link, focus ring, and accent highlight
  updates everywhere. Swap the whole palette by editing `:root`. Adjust corner roundness via
  `--radius`.
- **Nav items** live in one config: `apps/web/lib/nav.ts`.
- **Reusable shell** (`components/app-shell/sidebar.tsx`, `top-bar.tsx`,
  `components/page-header.tsx`, `components/ui/status-pill.tsx`) localizes layout/polish — edit
  one file to change that piece app-wide.
- Tokens map to Tailwind utilities via the `@theme inline` block in `globals.css`; add a new
  token there to expose a new utility.

This is the path for the later "polish" pass — change tokens/components in place, no rewrites.

## Provenance

Owner-provided references on 2026-06-16: Resend screenshots (Mobbin), a Steady/Status Hero
check-ins screenshot, and a 4.5s Steady walkthrough clip (team-tab navigation + feed + stats
rail + roster). Stored as the basis for [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) §8 UI.

---

## Polish pass — 2026-06-27 (Crisp Product)

**This section is authoritative** where it conflicts with the original direction above.
References: Clerk + Hex admin dashboards (owner-provided via Mobbin). Direction chosen:
**Crisp product** — cool-white canvas, true-black ink, an all-grotesk type system, and a single
saturated **cobalt** accent used sparingly. Goal: a refined, "designed" SaaS-admin feel without
the indigo-on-zinc generic look.

### What changed vs. the original direction
| Area | Was (2026-06-16) | Now (2026-06-27) |
|---|---|---|
| Brand accent | indigo `#6366F1` | **cobalt `#2D5BFF`** (`--accent-strong` `#1D44D6` for hover) |
| Display type | Instrument **Serif** | **Schibsted Grotesk** (`--font-display`) — no serif |
| Primary button | solid black | unchanged (black); cobalt reserved for active nav / links / focus / the `accent` button variant |
| Elevation | flat, hairline only | **layered shadow tokens** (`--shadow-xs/sm/card/md/lg`) on cards, tables, inputs |
| Motion | hover/route fade only | added **staggered load reveal** (`.reveal` + inline `animation-delay`) |
| Canvas | `#FFFFFF` | app bg `#FAFAFA`, cards `#FFFFFF` (crisp separation) |
| Borders | `#E4E4E7` | `#EBEBEF` (lighter/crisper) |

### Tokens (current, light `:root`)
`--background #FAFAFA` · `--card #FFFFFF` · `--foreground #0A0A0B` · `--muted-foreground #6B6B76`
· `--subtle-foreground #9B9BA6` · `--border #EBEBEF` · `--input #E6E6EB` · `--accent #2D5BFF` ·
`--accent-strong #1D44D6` · `--accent-subtle #ECF1FF` · `--ring #2D5BFF` · `--radius 0.625rem`.
Status families (`success/warning/danger` + `-subtle`/`-foreground`) retuned for crispness.
Dark theme (`.dark`, used by `/login`) mirrors these with a lighter cobalt `#5B82FF`.
Depth tints: `--shadow-tint` / `--shadow-tint-strong` drive all shadow tokens.

### Type
- **Body / UI:** Geist Sans — wired via `--font-sans` (**bugfix:** the variable was previously a
  circular self-reference, so the app silently rendered in system fonts).
- **Display / headings (`h1–h3`, page titles, brand, stat numbers):** Schibsted Grotesk via
  `--font-heading`; `-0.02em` tracking. Use the `.font-heading` utility to opt other elements in.
- **Mono:** Geist Mono — IDs, Slack handles, channel names.
- Instrument Serif was **removed** from `app/layout.tsx`.

### Depth & motion
- Cards/tables/inputs use `shadow-card` / `shadow-xs`; overlays would use `shadow-md/lg`.
- `.reveal` animates opacity + 8px rise (`cubic-bezier(0.22,1,0.36,1)`, 0.5s), respects
  `prefers-reduced-motion`. Stagger lists with inline `style={{ animationDelay: \`${i*50}ms\` }}`.

### Shared primitives (new — reuse these, don't re-style inline)
- **`components/ui/form.tsx`** — `Field`, `Label`, `Input`, `Textarea`, `Select` (white field +
  cobalt focus ring via `fieldClass`), plus `Card` and `SectionTitle`. All forms consume these.
- **`components/ui/empty-state.tsx`** — `EmptyState` (icon tile + title + description + action).
- **`components/page-header.tsx`** — now supports `eyebrow` + `description` (28px display title).
- **`components/ui/button.tsx`** — added an **`accent`** (cobalt) variant; taller `default`/`lg`.
- **`components/ui/status-pill.tsx`** — leading status dot + inset ring.
- **`components/ui/data-table.tsx`** — elevated, row hover `surface-muted/60`.
- **App shell:** `sidebar.tsx` (grouped Workspace/Manage sections, active accent bar, account
  card) and `top-bar.tsx` (sticky, blur, route-derived breadcrumb, ⌘K affordance).

The single-file reskin path still holds: all tokens live in `apps/web/app/globals.css`
(`:root` light, `.dark` for `/login`); components use only semantic classes. Change `--accent`
once → every active state updates.

### Resolved in follow-up (2026-06-27)
- ✅ **Dead nav links** — built `/standups` (per-team schedule/status index) and `/settings`
  (read-only account + role/access + sign-out). Both nav items now resolve.
- ✅ **Loading / page error UX** — added `(dashboard)/loading.tsx` (skeleton matching the page
  shell), `(dashboard)/error.tsx` (client boundary with retry + digest), and
  `(dashboard)/not-found.tsx` (friendly 404 for `notFound()` on missing teams/reports).
- ✅ **Mobile / responsive** — new client `components/app-shell/app-shell.tsx` owns drawer state:
  `Sidebar` is a static rail on `md+` and a slide-in drawer (backdrop, Esc-to-close, body-scroll
  lock, route-change close) on mobile, opened by a hamburger in `TopBar`. `DataTable` now scrolls
  horizontally (`overflow-x-auto`, `min-w-[640px]`) instead of crushing columns; `main` and
  `TopBar` padding scale down on small screens.
- ✅ **Form-level error feedback** — `components/ui/form.tsx` adds an `ActionState`/`FormAction`
  type + `FormError`. The three data-entry forms (Create Team, Add Member, Standup config) use
  `useActionState`: validation/save failures now render inline (red alert) with a pending/disabled
  submit button, instead of throwing to the error boundary. Add Member resets on success.

### Still pending
1. **Dark-mode toggle** — both token sets exist but the product app is light-only; no switcher.
2. **⌘K search** — top-bar affordance is decorative; no command palette wired.
3. **Toggle/select action errors** — quick actions (role select, permission toggles, manager
   assign/remove, pause/resume, member remove) still throw to the error boundary; only the three
   main forms have inline feedback.
4. **Richer report visuals** — Steady-style participation bar + stats rail (from the original
   direction) still not built; reports are cards + table.
5. **Branding** — favicon / app-icon / OG image.
6. **Visual QA** — authenticated screens not yet screenshotted (needs live DB + Slack session).
