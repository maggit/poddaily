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
- **Geekbot** (original PRD reference) — the *information layout*: participation bar with
  reporter avatars (reported vs not), the member **permission table** (View/Report/Edit),
  the **schedule picker** (weekday chips + time + tz), the **question editor**.

**Core principle:** Resend's restraint and polish, carrying Steady's standup-native components,
laid out with Geekbot's admin information density.

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
  not-reported right), % label — Geekbot Insights pattern in this palette.
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

## Provenance

Owner-provided references on 2026-06-16: Resend screenshots (Mobbin), a Steady/Status Hero
check-ins screenshot, and a 4.5s Steady walkthrough clip (team-tab navigation + feed + stats
rail + roster). Stored as the basis for [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) §8 UI.
