# poddaily

> Self-hosted, Slack-native daily standup bot + admin platform. Open-source, no per-seat cost.

**Status:** Phase 1 (Core) is **feature-complete** — all 7 build steps land with automated
smokes green in CI; the remaining gates are the live-workspace runbook walks. This README and
the feature checklist below grow as each phase lands.

poddaily DMs each team member their standup questions in Slack, one at a time, then posts a
tidy summary to the team's channel — attributed to the person who wrote it. An admin web UI
manages teams (pods), members, questions, and schedules. It runs entirely on your own
infrastructure.

## Features

Checked items are implemented; unchecked are planned. Updated at the end of each phase.

**Phase 1 — Core**
- [x] Slack OAuth admin login
- [x] Team CRUD (name, Slack channel, tribe)
- [x] Member management with per-member permissions + timezone capture
- [x] Standup configuration (questions, schedule, intro/outro)
- [x] Per-user-timezone scheduler (Step 5a — outbound DM only; Q&A engine in 5b)
- [x] Conversational DM Q&A (one question at a time, skip / skip all, 4h timeout)
- [x] Channel broadcast posted as the user, threaded under a daily opening message
  - Connected members post via their own Slack user token (true authorship, no "APP" badge, counts as a user message in Slack analytics); unconnected members fall back to a bot post (`chat:write.customize`) with a "Connect" nudge — Step 6a delivered the broadcast/threading, Step 6b the post-as-user
- [x] Reports dashboard (today + history, per-person check-in feed with Slack avatars) — admin-only

**Phase 2 — Admin UX:** today's dashboard ✅ (sub-project A — reports dashboard, shipped),
participation stats, one-click reminders (B), pause/resume + admin controls (C), RBAC tiers (D).
**Phase 4 — P1:** analytics, `/standup` slash command, Databricks export webhook, streaks.

See the full [roadmap](#roadmap) and the [PRD](ContextDB/01_specs/poddaily-prd.md) for scope.

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

# The admin web app (login + dashboard):
pnpm --filter @poddaily/web dev   # → http://localhost:3000 (signed out → /login)
```

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
Slack channel: the worker posts a `📋 Daily Standup … Reported: n out of total` opening message
once per run, and the api posts each completed report as a threaded Block Kit reply under it
(attributed to the member via `chat:write.customize` — the bot posts with the member's
name/avatar) and updates the counter. The broadcast is best-effort: a post failure is logged
as `[broadcast] degraded` and swallowed, never reverting the completed report. **The bot must
be invited to each team's Slack channel** (`/invite @poddaily`), otherwise `chat.postMessage`
returns `not_in_channel` and the broadcast is logged as degraded.

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

## Configuration

All configuration is via environment variables; copy `.env.example` to `.env.local`. Each
variable, where it comes from, and its local-vs-live value are documented in the
[env var reference](ContextDB/00_index/getting-started.md#environment-variable-reference).

`STANDUP_TIMEOUT_MS` (default `14400000` = 4h) is the per-report timeout deadline: after a
member's standup DM has been open this long without finishing, the report is marked
`timed_out` and is **not** broadcast. Lower it only for testing (e.g. `1500`).

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

Hosted on **Dokploy** (self-hosted, Docker + Traefik) with a **Supabase cloud** Postgres. Each
app is a Docker service: `web` via `Dockerfile.web`, `api` via `Dockerfile.api`, and `worker`
via `Dockerfile.worker` (both run via `tsx`), with Redis as a compose service — all activated
in `docker-compose.dokploy.yml`. The `api` is mapped to a domain so Slack can reach its
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
| 2 — Admin UX | Reports dashboard ✅ (sub-project A), participation stats, reminders (B), pause/resume + admin controls (C), RBAC (D) |
| 3 — Polish + launch | Deploy, env config, docs, pilot |
| 4 — P1 features | Analytics, slash command, export webhook, streaks |

## Contributing

This is an open-source project. Before working on a phase, read the relevant spec and ADRs in
[`ContextDB/`](ContextDB/). Each phase ships with passing smoke tests, an updated README, and
the live smoke runbook walked once (see the per-phase Definition of Done in
[Testing & Local Dev](ContextDB/02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)).

## License

TBD — to be set before the first public release.
