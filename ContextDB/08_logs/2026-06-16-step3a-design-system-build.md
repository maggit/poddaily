# 2026-06-16 — Step 3 Part 1 Build: Design System + App Shell

Executed the [Step 3 Part 1 plan](../todos/2026-06-16-phase1-step3a-design-system-plan.md) via
subagent-driven development on branch `phase1-step3a-design-system`. Applied the locked
[design direction](../04_knowledge/design-direction.md) to `apps/web`.

- **Theme tokens (single source):** merged the poddaily palette into `globals.css` — light
  product `:root` + scoped `.dark` auth theme, indigo `--accent`, status families, mapped to
  Tailwind utilities via `@theme inline`. App is light by default.
- **Fonts:** added Instrument Serif (display) alongside Geist Sans/Mono.
- **Login:** restyled to a dark premium card with the serif "poddaily" wordmark.
- **App shell:** reusable `Sidebar` (active-nav highlight, account chip), `TopBar`
  (breadcrumb + search + avatar), `PageHeader`, and a themable `StatusPill`. Nav config in
  `lib/nav.ts`. Dashboard renders inside the shell; auth guard preserved.

## Themability (owner requirement)
Components use **only** semantic theme classes — no hardcoded colors. Reskinning = edit token
values in `apps/web/app/globals.css` (e.g. change `--accent`); nav lives in `lib/nav.ts`. No
component edits needed to restyle. Documented in
[design-direction §Theming](../04_knowledge/design-direction.md#theming--how-to-restyle-single-file-change).

## Verification
- `pnpm test`: 11 pass (presentational change, no regressions).
- `pnpm --filter @poddaily/web build`: success.
- dev: `/login` dark (200); `/dashboard` light shell, redirects to `/login` when signed out.

## Watch-item
base-nova's font mapping is indirect (`--font-sans` ← `--font-sans`, while Geist sets
`--font-geist-sans`). Build is clean; confirm Geist actually applies on the rendered page in a
quick visual pass — one-line fix if the body font falls back.

Next: Step 3 Part 2 — team + member CRUD (teams list, create-team form, member table) via Next
server-side against `@poddaily/db` (`smoke:team`).
