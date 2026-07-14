# poddaily

> Self-hosted, Slack-native daily standup bot + admin platform. Open-source, no per-seat cost.

**Website:** [poddaily.io](https://poddaily.io/) · **Installation guide:** [poddaily.io/install](https://poddaily.io/install) · **Self-hosting:** [SELF_HOSTING.md](SELF_HOSTING.md)

**Status:** Phase 1 (Core) is **feature-complete** — all 7 build steps land with automated
smokes green in CI; the remaining gates are the live-workspace runbook walks. This README and
the feature checklist below grow as each phase lands.

poddaily DMs each team member their standup questions in Slack, one at a time, then posts a
tidy summary to the team's channel — attributed to the person who wrote it. An admin web UI
manages teams (pods), members, questions, and schedules. It runs entirely on your own
infrastructure.

## Features

Everything below is implemented and shipping today. See the [roadmap](#roadmap) for
what's next and the [PRD](ContextDB/01_specs/poddaily-prd.md) for the full scope.

<!-- Screenshots: drop images into docs/screenshots/ and uncomment the placeholders below. -->

### Standups in Slack

- **Conversational DM Q&A** — the bot asks each member their questions one at a time in a
  DM; `skip` skips a question, `skip all` skips the day.
- **Per-user-timezone scheduling** — every member is asked on their own clock, on the
  days the standup is configured to run.
- **Channel broadcast, attributed to the author** — completed check-ins post directly to
  the team channel under a live `📋 Reported n/total` header. Members who connect their
  Slack account post **as themselves** (a true user message, no "APP" badge); everyone
  else gets a bot post with their name and avatar plus a "Connect" nudge.
- **Reminders** — recurring DM nudges (per-standup interval, default 60 min) until the
  member finishes or times out.
- **Inactivity timeout** — a report only times out after a configurable silent period
  (default 4 h); the clock resets on every reply, so answering across the morning is fine.
- **Catch-up on demand** — DM the bot `redo` / `restart` / `start` / `standup` to re-run
  a missed or timed-out standup.
- **`/standup` slash command** — `start`, `status`, and `help` from any channel, with
  ephemeral replies; the Q&A itself stays in the DM.
- **Late-join delivery** — a member added (or granted Report permission) mid-day still
  receives today's standup if the run is open.
- **Pause / resume** — pause a standup without losing its configuration; in-flight runs
  finish, no new ones are sent.

<!-- ![Standup DM Q&A](docs/screenshots/standup-dm.png) -->
<!-- ![Channel broadcast](docs/screenshots/channel-broadcast.png) -->

### Admin web app

- **Sign in with Slack** — official OpenID Connect flow; no passwords to manage.
- **Team (pod) management** — create teams, set the Slack channel and tribe, manage
  members with per-member permissions and timezone capture.
- **Standup configuration** — questions, schedule, intro/outro text, and the reminder
  interval, per team.
- **Reports dashboard** — today's participation across all teams, plus per-team history:
  a feed of per-person check-in cards with Slack avatars and full answers.
- **Role-based access** — `viewer` / `manager` / `admin` tiers; the first login on a
  fresh install bootstraps as admin, and the last admin can never be demoted, so an
  install can't lock itself out.
- **Slack-connected badge** — see at a glance which members post as themselves.
- **Public landing + private sign-in** — `/` is an informative landing page; the actual
  sign-in lives at the unlinked `/team`.
- **Reskin from one file** — every design token lives in `apps/web/app/globals.css`;
  change `--accent` once and the whole app follows.

<!-- ![Reports dashboard](docs/screenshots/reports-dashboard.png) -->
<!-- ![Standup configuration](docs/screenshots/standup-config.png) -->

### Integrations

- **Linear** — a signature-verified webhook (multiple signing secrets supported)
  ingests assigned-issue activity, matches people to team members by email, and surfaces
  each member's closed issues alongside their check-ins in reports. Includes an
  unmatched-people view, a last-event health indicator, retention pruning, and a
  disconnect control.

<!-- ![Integrations](docs/screenshots/integrations.png) -->

### Self-hosting & operations

- **Runs entirely on your infrastructure** — one published Docker image
  (`ghcr.io/maggit/poddaily`, amd64 + arm64) runs all three processes (`web`, `api`,
  `worker`); a batteries-included compose file bundles Postgres and Redis. See
  **[SELF_HOSTING.md](SELF_HOSTING.md)**.
- **No per-seat cost, your data stays yours.**
- **Secure by default** — Slack request-signature verification, AES-GCM-encrypted user
  tokens at rest, all secrets via environment variables.
- **Developable offline** — a bundled Slack API stub means local dev and the entire
  `smoke:*` test suite need no Slack workspace or external accounts.

## Tech stack

Next.js 15 · Hono.js (Node 22) · BullMQ + Redis · PostgreSQL 16 (Supabase, managed) ·
Drizzle ORM · NextAuth v5 (Slack OAuth) · Tailwind + shadcn/ui · `@slack/bolt` ·
Dokploy. Monorepo via pnpm workspaces.

## Quick start

Run it locally with a stubbed Slack — no external accounts needed:

```bash
pnpm install
cp .env.example .env.local        # stub values are fine for local
supabase start                    # local Postgres
docker compose up -d redis        # queue
pnpm db:migrate && pnpm seed      # schema + known-state data
pnpm smoke:db                     # foundation end-to-end check (schema + seed + connectivity)
pnpm smoke:auth                   # admin Slack-login flow against the stub

# The admin web app (landing page, login + dashboard):
pnpm --filter @poddaily/web dev   # → http://localhost:3000
```

The web app serves a public landing page at `/`; the admin **sign-in page lives at `/team`**
(intentionally unlinked from the landing page — share it with your team directly). Protected
routes redirect there automatically.

> **Current state (through Step 5a):** the commands above work today — the database layer,
> the admin web app with Slack OAuth login, team/member/standup CRUD, and the scheduler +
> outbound standup DM worker. The multi-service `pnpm dev` and the full `pnpm smoke:phase1`
> arrive as later build steps land — see the
> [build order](ContextDB/01_specs/phase-1-core-spec.md#9-build-order-vertical-slice).
>
> **`pnpm test` requires both Postgres and Redis** (`supabase start` + `docker compose up -d redis`)
> — Redis is needed by the `smoke:standup-outbound` suite that runs as part of the default test run.

For the **complete from-zero runbook** — creating a Supabase project, registering and
configuring the Slack app (scopes, event URLs, tokens), tunnels, the reporter user-OAuth, and
every environment variable — see **[Getting Started](ContextDB/00_index/getting-started.md)**.

### Worker (scheduler + standup DMs)

The worker schedules and sends standup DMs. It needs Redis:

    docker compose up -d redis          # local Redis for BullMQ
    pnpm --filter @poddaily/worker dev  # boots the scheduler + DM worker

Trigger a run immediately (instead of waiting for the daily tick):

    pnpm --filter @poddaily/worker trigger <standupId>

Env: `REDIS_URL` (BullMQ), `SLACK_BOT_TOKEN` (bot DM posting). In tests/smoke,
`SLACK_API_BASE_URL` points the bot client at the local Slack stub.

### Inbound DM Q&A (Step 5b)

The conversational Q&A engine runs as the `apps/api` Bolt service. Members answer their
standup one question at a time in the DM; `skip` records "(skipped)" and advances, `skip all`
aborts the report. On the last question the report is marked `completed` and the outro is
posted to the DM.

**Channel broadcast (Step 6a).** On completion the report is also broadcast to the team's
Slack channel: the worker posts a `📋 Daily Standup … Reported: n out of total` header message
once per run, and the api posts each completed report **directly to the channel** (not in a
thread — so updates are visible in the main channel feed) as a Block Kit message, then updates
the header's live counter. Reports post even if the header failed to send. Each report is
attributed to the member via `chat:write.customize` (the bot posts with the member's
name/avatar). The broadcast is best-effort: a post failure is logged as `[broadcast] degraded`
and swallowed, never reverting the completed report. **The bot must be invited to each team's
Slack channel** (`/invite @poddaily`), otherwise `chat.postMessage` returns `not_in_channel`
and the broadcast is logged as degraded.

**Step 6b** makes connected members post **as themselves**. Each member completes a one-time
reporter user-OAuth (`/api/slack/install` → `/api/slack/oauth/callback`) granting a `chat:write`
**user token**, stored AES-GCM-encrypted; the api then posts that member's report with their own
user token — a true user message, **no "APP" badge**, counted as a user message in Slack
analytics. Unconnected members keep the 6a name/avatar fallback (`chat:write.customize`) plus a
"Connect to post as yourself" nudge in the DM intro. For this to work the Slack app needs the
**`chat:write` user scope** and the redirect URL `${web}/api/slack/oauth/callback`;
**`INTERNAL_API_SECRET` must be set on the `api` service** (it decrypts the stored user token);
and the member must be **in the channel** for their token to post there. On a successful connect,
the member gets a Slack DM confirmation ("✅ You're connected!"), so the **`web` service also needs
`SLACK_BOT_TOKEN`** set (to send that DM) in addition to `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`.

    pnpm --filter @poddaily/api dev     # boots the Bolt service

Env: `SLACK_SIGNING_SECRET` (Slack request-signature verification) and `SLACK_BOT_TOKEN`. It
listens on `PORT` (default `3001`); its Slack **Event Subscriptions request URL** is
`https://<api-domain>/slack/events`, subscribed to the `message.im` bot event.

### Re-trigger a missed standup (DM keyword)

If a member missed their standup for the day (it timed out, or the server was down when it
should have run), they can re-start it themselves by DMing the bot one of the keywords
**`redo`**, **`restart`**, **`start`**, or **`standup`** (the whole message, case-insensitive).
The bot re-opens today's run if needed, re-asks the questions in the DM, and posts to the
channel on completion as usual. If they've already reported today, the bot replies
"You've already reported today ✅" and does nothing. This reuses the existing `message.im`
subscription — **no Slack app config change** — but the **`api` service now needs `REDIS_URL`**
(it enqueues a `retrigger` job that the worker handles); `bullmq` is a runtime dependency of the
api.

### `/standup` slash command (Phase 4 — P1)

Members can start or check their standup from **any Slack channel** using the `/standup` slash
command. All replies are **ephemeral** (only the invoking member sees them); the actual Q&A
conversation happens in the bot DM as usual.

| Command | What it does |
|---|---|
| `/standup` or `/standup start` | Start your standup now — on demand, any day/time, bypassing the schedule. Blocks with a nudge if you've already reported; prompts you to finish the DM if one is already in progress. |
| `/standup status` | Shows your status for today: reported / in progress (N of M questions answered) / not reported yet. |
| `/standup help` | Lists the commands. Any unrecognized input also shows this. |

The `start` subcommand reuses the existing retrigger worker — it opens today's run if needed and
sends the standup intro + first question to your DM exactly as the DM keyword (`redo`/`start`/…)
does. If you've already reported today, it says so and does nothing (consistent with the DM keyword
behavior). If the standup is **paused**, both `start` and `status` tell you so (and `start` does
nothing) rather than pretending to send a DM.

**Deploy step.** After deploying, **update the Slack app from `app_manifest.yaml`** (Slack app
config → App Manifest → paste the updated YAML → Save) so the `/standup` command registers and
routes to the request URL. The `commands` bot scope is already granted — no reinstall needed.

### Reports dashboard (Phase 2 — sub-project A)

The admin web app exposes a read-only reports view (admin-only). `/reports` shows today's run
across all teams — participation (`reported/total`) and status — and clicking a team opens
`/reports/[teamId]`, a feed of per-person check-in cards (Slack avatar + name + status + the
member's Q&A answers) with a date selector to browse history. Answers render the interpolated
`{last_report_date}` exactly as the DM and channel broadcast do. It's a Server-Component
data-access view (`apps/web/lib/reports.ts`) — no REST API.

Avatars come from Slack via `users.info`, so the bot needs the **`users:read`** scope. A
member's avatar is fetched best-effort when they're added; for members added before this
shipped, run the one-off backfill once after deploy (needs `SLACK_BOT_TOKEN` on the `web`
service — already set — and `users:read`):

    pnpm --filter @poddaily/web backfill:avatars

When an avatar is missing the card falls back to the member's initials.

### Admin controls (Phase 2 — sub-project C)

- **Pause / resume a standup.** Each standup's config page (`/teams/[id]/standup`) shows an
  **Active / Paused** pill and a Pause/Resume button. Pausing flips `standups.is_active` — it's
  **future-only**: a run already open for today (and its in-progress reports) finishes, but no
  new run is sent. It takes effect at the very next scheduled tick (the worker's `open-run`
  no-ops on a paused standup), and the standup's repeatable schedule job is cleaned up on the
  next worker reconcile/boot. A paused standup also can't be re-triggered by the DM keyword.
- **Slack-connected badge.** The team detail page's member table shows, per member, whether they
  have connected their reporter user-OAuth token (**Connected** vs **Not connected**) — i.e.
  whether their reports post as themselves vs. the bot fallback.
- **Late-join delivery.** Adding a member — or flipping an existing member's **Report** permission
  on — mid-day delivers **today's** standup to them if the run is already open (otherwise the
  normal schedule / next scheduled day applies; a finalized run still counts — their report
  appends to today's thread). For this catch-up to fire, the **`web` service needs `REDIS_URL`**
  set (and `bullmq` is a `web` dependency) — it enqueues a `send-dm` job that the worker handles.
  Without `REDIS_URL` the member is still added; they just don't get the same-day DM.
- **Reminders.** A member who gets their standup DM but doesn't finish receives recurring **DM**
  nudges until they complete it or hit the 4h timeout. The cadence is **per-standup** — a
  *"Reminder interval (minutes, 0 = off)"* field on the standup config page, **default 60 min**.
  E.g. at 60 min with the 4h timeout, nudges fire at 1h / 2h / 3h. Driven by the worker (it
  already needs `REDIS_URL`); no new env or Slack config. The `standup_reminders` table records
  each nudge sent.

### Roles & access (Phase 2 — sub-project D)

poddaily has three role tiers for the admin web app:

| Role | What they can do |
|---|---|
| **viewer** | View teams, reports, standup config — no edits |
| **manager** | Everything a viewer can do, plus edit and configure the teams they own |
| **admin** | Everything — create teams, edit any team, assign roles, assign team managers |

**Bootstrap.** On a fresh install, the very first person to log in (while no admin exists in
the database) is automatically made `admin`. Every subsequent new login is auto-provisioned as
a `viewer`. Existing users keep their role on re-login.

**Promoting users.** An admin opens **People** (sidebar link, admin-only) and changes any
user's role via the dropdown. Role changes take effect immediately — roles are read fresh from
the database on every request, not cached in the login token, so no re-login is required. To
let a manager administer a team, promote them to `manager` on the People page, then open the
team's page and assign them under the **Managers** section.

**Safeguard.** The last admin cannot be demoted. Attempting to do so is rejected server-side,
so no install can become locked out of its own admin UI.

See the [RBAC ADR](ContextDB/03_decisions/2026-06-26-rbac-role-tiers.md) and the
[role-tier spec](ContextDB/01_specs/phase-2-d-rbac-spec.md) for the full design.

### Admin UI & theming

The admin web app uses a "Crisp Product" design system — cool-white canvas, true-black ink, a
distinctive grotesk pairing (Geist body + Schibsted Grotesk display, both via `next/font` — no
install step), a single cobalt accent, layered elevation, and subtle load-reveal motion.

It's built to **reskin from one file.** All design tokens live in
[`apps/web/app/globals.css`](apps/web/app/globals.css) (`:root` = the light product theme;
`.dark` = the `/login` theme), and components only use semantic classes. Change `--accent` once
and every active nav item, link, focus ring, and accent button updates app-wide; swap the whole
palette by editing `:root`; adjust corner roundness via `--radius`. Reusable building blocks live
in `apps/web/components/ui/` (`form`, `button`, `data-table`, `status-pill`, `empty-state`,
`avatar`) and the app shell (`components/app-shell/`). Full spec + what's still pending:
[design-direction.md](ContextDB/04_knowledge/design-direction.md#polish-pass--2026-06-27-crisp-product).

## Configuration

All configuration is via environment variables; copy `.env.example` to `.env.local`. Each
variable, where it comes from, and its local-vs-live value are documented in the
[env var reference](ContextDB/00_index/getting-started.md#environment-variable-reference).

> **`NEXTAUTH_URL` is needed on `web`, `api`, and `worker`.** Beyond auth, the `worker` uses it to
> build the daily "Connect to post as yourself" nudge in the standup DM for members who haven't
> connected, and the `api` uses it for the inline connect link on bot-posted reports. If it's unset
> on those services the standup still runs and unconnected members' updates still post (as the bot,
> with their name) — the connect prompts are just silently skipped.

**Landing-page identity (web only, both optional):** `PODDAILY_INSTANCE_NAME` sets a display
name for your deployment — the landing page shows a sticky turquoise banner ("You're on the
Clara poddaily instance") with a "Sign in to Clara" link to `/team`, plus the same link in the
header nav. Unset, the banner reads "You're on a self-hosted poddaily instance" with a plain
"Sign in" link. `PODDAILY_OFFICIAL_INSTANCE=true` is for the canonical poddaily.io deployment
only: it hides the instance banner and sign-in links (poddaily.io is the marketing site, not a
team instance) and shows the maintainer credit in the footer instead. Self-hosters should leave
it unset (default `false`).

`STANDUP_TIMEOUT_MS` (default `14400000` = 4h) is the per-report **inactivity** timeout: the
clock resets every time a member replies, so a report is only marked `timed_out` (and not
broadcast) after this long with **no reply** — not a fixed deadline from when the DM was sent.
A member can answer over the course of the morning as long as they don't go silent for the full
window. Lower it only for testing (e.g. `1500`). **Set it to the same value on both the `api` and
`worker` services** — the worker arms the timeout and the api resets it on each answer (the api
stamps `standup_reports.timeout_at`); if they disagree, the reset deadline won't match the worker's.

## Testing

- `pnpm test` — unit + integration. **Requires both Postgres and Redis** (`supabase start` +
  `docker compose up -d redis`) — the `smoke:standup-outbound` suite runs as part of the
  default test run and needs Redis (consistent with Postgres already being required).
- `pnpm smoke:standup-outbound` — outbound DM smoke: boots a real BullMQ queue + worker against
  Redis and the Slack stub, triggers a run, asserts DMs sent and `standup_reports` rows created.
- `pnpm smoke:standup` — full outbound→inbound smoke: the outbound run above followed by the
  inbound Q&A driven through `handleMessage` to a `completed` report + outro.
- `pnpm smoke:phase1` — end-to-end smoke against the whole stack with a stubbed Slack.
- A manual [live smoke runbook](ContextDB/02_architecture/testing-and-local-dev.md#live-smoke-runbook-before-shipping-a-phase)
  validates one real standup against a Slack dev workspace before a phase ships.

See [Testing & Local Dev](ContextDB/02_architecture/testing-and-local-dev.md).

## Deployment

**Self-hosters:** pull the published image and follow **[SELF_HOSTING.md](SELF_HOSTING.md)**
— `deploy/docker-compose.yml` runs the whole stack (web, api, worker, Postgres, Redis) from
`ghcr.io/maggit/poddaily`, with migrations applied automatically on container start. Releases
are semver git tags (`vX.Y.Z`) published by `.github/workflows/release.yml`.

The reference deployment (poddaily.io) runs on **Dokploy** (self-hosted, Docker + Traefik)
with a **Supabase cloud** Postgres, building from source via the unified `Dockerfile` and
`docker-compose.dokploy.yml`: all three processes are the same image with different commands
(`web` / `api` / `worker`), plus Redis. The `api` is mapped to a domain so Slack can reach its
`/slack/events` request URL; the `worker` has no domain. Full step-by-step:
**[Dokploy + Supabase runbook](ContextDB/02_architecture/deployment-dokploy.md)** (Railway is a
documented alternative — same image — in the [Railway runbook](ContextDB/02_architecture/deployment-railway.md)).

## Project context & docs

Long-lived context lives in [`ContextDB/`](ContextDB/) (managed with ContextLoom). Start at
the [project map](ContextDB/00_index/project-map.md): specs, architecture, and the
[decision records](ContextDB/03_decisions/) behind every major choice.

## Roadmap

| Phase | Scope |
|---|---|
| 1 — Core ✅ feature-complete | Auth, team CRUD, standup config, Slack DM flow, channel broadcast, scheduler |
| 2 — Admin UX ✅ | Reports dashboard ✅ (A), reminders ✅ (B), pause/resume + connected badge ✅ (C), RBAC tiers ✅ (D) |
| 3 — Polish + launch | Deploy, env config, docs, pilot |
| 4 — P1 features | Analytics, ~~slash command~~ ✅, export webhook, streaks |

**Up next:** standup analytics · Databricks export webhook · participation streaks ·
email invites for viewers (via Resend) as part of admin onboarding.

## Contributing

Contributions are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for the dev setup,
project layout, and PR conventions. Before working on a phase, read the relevant spec and
ADRs in [`ContextDB/`](ContextDB/). Each phase ships with passing smoke tests, an updated
README, and the live smoke runbook walked once (see the per-phase Definition of Done in
[Testing & Local Dev](ContextDB/02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)).

Found a security issue? Please use
[private vulnerability reporting](https://github.com/maggit/poddaily/security/advisories/new)
instead of a public issue.

## License

[MIT](LICENSE)
