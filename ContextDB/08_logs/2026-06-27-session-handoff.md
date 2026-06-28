# 2026-06-27 — Session handoff (UI redesign + auth fix)

A continuation doc for picking work back up. Covers everything shipped today on the admin web
app (`apps/web`) and what's still open. Detailed references:
- Design system: [design-direction.md → Polish pass 2026-06-27](../04_knowledge/design-direction.md#polish-pass--2026-06-27-crisp-product)
- Redesign build log: [2026-06-27-ui-polish-redesign.md](2026-06-27-ui-polish-redesign.md)

## What shipped today (all merged to `main`, pushed)

Three merges to `main`:
| Merge | What |
|---|---|
| `Merge feat/ui-redesign-crisp-product` (`cf405c2`) | UI redesign + nav pages + loading/error + mobile + form errors |
| `Merge fix/auth-stable-slack-uid` (`fdc4a91`) | Login/identity fix (stable Slack UID + email reconciliation) |

(The redesign landed as one large commit `526e627`; the auth fix as `a818d8f`.)

### 1. "Crisp Product" UI redesign
Reworked the admin app from the default shadcn/indigo-on-zinc look into a Clerk/Hex-grade system:
cool-white canvas, true-black ink, **Geist body + Schibsted Grotesk display**, a single **cobalt**
accent (`#2D5BFF`) used sparingly, layered shadow tokens, and staggered `.reveal` load motion.
- **Root-cause bug fixed:** `--font-sans` was a circular self-reference, so the app had been
  rendering in system fonts. Now wired to Geist + Schibsted Grotesk.
- Re-pigmented `:root` + `.dark` tokens, added `--shadow-*` depth tokens, `.reveal` utility.
- New shared primitives: `components/ui/form.tsx` (`Field/Input/Textarea/Select/Card/SectionTitle`
  + `ActionState`/`FormError`) and `components/ui/empty-state.tsx`.
- Upgraded `button` (added `accent` variant), `data-table`, `status-pill`, `page-header`
  (eyebrow + description), `avatar`.
- Restyled every dashboard page + `/login`; route-derived breadcrumb in `top-bar`.

### 2. Missing nav pages built (no more 404s)
- **`/standups`** — per-team schedule/status index (human-readable cron, question count,
  Active/Paused/Not-configured pill, configure link).
- **`/settings`** — read-only account: profile, role + access explainer, sign-out. No fake toggles.

### 3. Loading / error UX
Added route-group boundaries under `app/(dashboard)/`:
- `loading.tsx` — skeleton matching the page shell.
- `error.tsx` — client boundary with retry + digest.
- `not-found.tsx` — friendly 404 for `notFound()` (missing teams/reports).

### 4. Mobile responsive
- New client `components/app-shell/app-shell.tsx` owns drawer state; server `layout.tsx` just
  fetches the user and delegates.
- `Sidebar` = static rail on `md+`, slide-in drawer on mobile (backdrop, Esc, scroll-lock,
  route-change close) via a hamburger in `TopBar`.
- `DataTable` scrolls horizontally (`overflow-x-auto`, `min-w-[640px]`) instead of crushing columns;
  `main`/`TopBar` padding scales down on small screens.

### 5. Form-level error feedback
Create Team, Add Member, and Standup forms use `useActionState`: validation/save failures render
inline (`FormError`) with a pending/disabled submit button instead of throwing to the error
boundary. Add Member resets on success. Matching server actions now return `{ error }` / `{ ok }`.

### 6. Auth / identity fix (production-affecting)
**Symptom:** every login created a new `app_users` row (UUID `slack_user_id`s) and orphaned the
admin. **Cause:** `mapSlackProfile` stored the OIDC `sub` claim, which in this Slack tenant is an
opaque value that **rotates** between logins — not the Slack user id.
- `lib/slack-profile.ts` — prefer the stable `https://slack.com/user_id` claim (real `U…` id,
  consistent with `team_members`/`team_managers.slack_user_id`); `sub` is fallback only.
- `lib/users.ts` `provisionUserOnLogin` — transactional + **reconcile by email**: an unseen id with
  a known email adopts the existing row's highest role and deletes the stale duplicate(s).
  Self-heals existing duplicates on next login; new users still default to viewer; first-ever user
  still bootstraps to admin.

## Ops / deploy actions still required
- [ ] **After deploy, sign out and back in.** The current browser session still holds a token with
  the old UUID; re-login mints a token with the real Slack UID and triggers the self-heal (your 3
  duplicate rows → one `admin` row keyed on `U…`). **No manual DB delete needed** (deleting risks
  cascading away `team_managers` links and hits a first-login-wins admin race).
- [ ] Confirm the healed row: `slack_user_id` should start with `U…` and `role = admin`.

## Verification status
- `pnpm typecheck` ✅ · `pnpm lint` ✅ (web).
- Auth/RBAC tests ✅ — ran against a local Postgres: `slack-profile` (3), `users` (6, incl. new
  email self-heal), `auth-callbacks` (1), `authz` (2), `rbac-smoke` (1).
- **Not done:** visual QA of authenticated screens (needs a live DB + Slack session — only `/login`
  was rendered headless).

## Pending — continue tomorrow (priority order)
1. **Visual QA pass (highest).** Bring the stack up, log in, and eyeball every page on desktop +
   mobile. Confirm: drawer behavior, table horizontal-scroll, form inline errors, loading
   skeletons, the new `/standups` + `/settings`. Screenshot before/after. This is the one thing not
   yet verified by eye.
2. **Slack member search / autocomplete (requested feature).** Replace manual copy-paste of Slack
   user IDs in the Add Member form with a searchable, autocompleting picker that can reach **every**
   user in the workspace (400+ people). Detailed design + suggestions below in
   [Feature design: Slack member search](#feature-design-slack-member-search).
3. **`UNIQUE(email)` DB constraint (hardening).** Can't be added until prod duplicates are gone
   (migration would fail today). Once logins have settled to one row per person, add a Drizzle
   migration + partial unique index `where email is not null`. Makes duplicate users structurally
   impossible. *Decide:* also enforce in `provisionUserOnLogin` via `onConflict(email)`?
4. **Inline errors for quick toggle/select actions.** Role select, permission toggles, manager
   assign/remove, pause/resume, member remove still throw to the error boundary. At minimum surface
   the user-facing "Cannot remove the last admin" inline.
5. **Dark-mode toggle.** Both token sets exist; product is light-only. Add a switcher
   (cookie/localStorage + `.dark` on `<html>`).
6. **⌘K command palette.** The `top-bar` search affordance is currently decorative.
7. **Richer report visuals.** Steady-style participation bar + stats rail (in the original
   design-direction) not yet built; reports are cards + table.
8. **Branding.** favicon / app icon / OG image.

See also the canonical pending list:
[design-direction.md → Still pending](../04_knowledge/design-direction.md#still-pending).

## Feature design: Slack member search

**Goal.** In the Add Member form (and anywhere we pick a Slack user), let the admin **search by
name with autocomplete** instead of pasting a `U…` id. Must surface **every** user in the
workspace, performantly, on a workspace with **400+ members**.

**Why naive approaches fail (the past bug).** Slack has **no `users.search` API**. Apps that "miss
results" almost always do one of: (a) call `users.list` once and never follow the cursor, so they
only ever see the first page; (b) autocomplete client-side over a partial, capped list; or (c) hit
`users.list` live per keystroke and get throttled. The fix is to own a complete local copy of the
directory and search **that**.

### Recommended architecture — sync the directory, search locally
1. **Directory sync job (worker/cron).** Call `users.list` with **cursor pagination, draining
   ALL pages** — loop until `response_metadata.next_cursor` is empty. This is the single most
   important correctness detail. Upsert into a new table, e.g. `slack_directory_users`:
   `slack_user_id` (PK), `display_name`, `real_name`, `email`, `avatar_url`, `tz`, `is_bot`,
   `deleted`, `updated_at`. `users.list` is rate-limited (Tier 2, ~20 req/min); 400 users ≈ 2-3
   pages at `limit=200`, so a full sync is cheap. Handle HTTP 429 by honoring `Retry-After`.
   Schedule periodically (hourly/daily) **and** expose an on-demand "Resync directory" action.
   There is no Slack delta API, so just re-run a full sync — it's idempotent via upsert.
   - Reuse `@poddaily/slack-client`: add a `listAllUsers()` that encapsulates the cursor loop +
     backoff. Filter out `deleted`, `is_bot`, and Slackbot before upserting (or keep them and
     filter at query time).
   - Scopes: `users:read` (already granted for avatars) and `users:read.email` for email.
2. **Search endpoint (local, fast).** Query `slack_directory_users` server-side. For substring /
   typo-tolerant autocomplete use a **Postgres trigram index** (`pg_trgm`): a GIN index on
   `lower(coalesce(display_name,'') || ' ' || coalesce(real_name,'') || ' ' || coalesce(email,''))`
   and match with `ILIKE '%q%'` ordered by `similarity()`. (Alternative: tsvector FTS — good for
   word-prefix, weaker for mid-string substrings; trigram is the better default for name search.)
   Return a small page (e.g. 10-20) with a cursor/offset for "load more". Because the table holds
   the **whole** directory, results are complete by construction — pagination is just for UI, not a
   coverage gap.
3. **Frontend autocomplete (combobox).** Debounced input (~200ms), min 1-2 chars, **abortable**
   requests (cancel stale ones), keyboard nav, render avatar + display name + `@handle`. Drive it
   from a Next route handler or server action that calls the search endpoint. On select, store the
   real `slack_user_id` into the existing hidden field — the rest of `addMember` is unchanged. Show
   "Showing top N — keep typing to refine" rather than implying the list is exhaustive.

### Key best-practices / gotchas to honor
- **Always drain the cursor** in `users.list`; never trust a single page. Add a test/asserts on the
  loop. This is the root cause of "search misses people."
- **Respect rate limits**: exponential backoff on 429 + `Retry-After`; sync off the request path
  (worker), never per-keystroke against Slack.
- **Index for search**: `pg_trgm` GIN index; without it, `ILIKE '%…%'` does seq scans (fine at 400,
  bad as the workspace grows). Cap result size and paginate.
- **Freshness vs. cost**: periodic full re-sync + manual resync is simplest and correct for this
  scale; revisit incremental only if the directory gets huge.
- **Data hygiene**: exclude bots/deactivated by default; dedupe by `slack_user_id`; keep
  `updated_at` to show staleness and to prune people who left.
- **Reuse**: this directory table can also back the People/manager pickers and avatar lookups,
  replacing ad-hoc `getUserProfile` calls.

### Suggested build order
1. `slack_directory_users` table + migration (with the trigram index).
2. `listAllUsers()` (cursor-draining + backoff) in `@poddaily/slack-client`; a `syncDirectory()`
   in the worker + a scheduled trigger + an admin "Resync" action.
3. `searchDirectory(q, cursor)` data-access fn (trigram query, paginated).
4. Combobox component (debounce, abort, keyboard, avatar rows) wired into `AddMemberForm`
   (and reuse for manager assignment).
5. Tests: cursor-draining loop (mock multi-page), search ranking/pagination, empty/no-match states.
