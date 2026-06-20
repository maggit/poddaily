# Getting Started — Run & Test poddaily Locally

The complete, from-zero runbook to get poddaily running and to test it end-to-end. Two
tracks:

- **Track A — Local + stubbed smoke:** fully offline, deterministic, **no real Slack or
  Supabase cloud account needed**. This is what CI runs and what you use day-to-day.
- **Track B — Live end-to-end:** a real Supabase project + a real Slack app in a dev
  workspace, to walk the [live smoke runbook](../02_architecture/testing-and-local-dev.md#live-smoke-runbook-before-shipping-a-phase)
  before a phase ships.

> Note: the `pnpm` scripts referenced below (`db:migrate`, `seed`, `smoke:*`) are the planned
> developer interface defined by this spec; they are implemented as part of Phase 1 build
> step 1. This doc is the contract for what "run it locally" means.

---

## Prerequisites (both tracks)

| Tool | Why | Install |
|---|---|---|
| Node 22 + corepack | Runtime | `nvm install 22 && corepack enable` |
| pnpm | Monorepo package manager | `corepack prepare pnpm@latest --activate` |
| Docker | Runs Redis (and Supabase local containers) | Docker Desktop |
| Supabase CLI | Local Postgres matching prod | `brew install supabase/tap/supabase` |
| ngrok or cloudflared | Public tunnel so Slack can reach localhost (Track B only) | `brew install ngrok` |

```bash
git clone <repo-url> poddaily && cd poddaily
pnpm install
cp .env.example .env.local
```

---

## Track A — Local + stubbed smoke (no external accounts)

This runs the whole stack with the **Slack stub** standing in for Slack, so you can test the
full DB → API → worker → broadcast pipeline without any Slack/Supabase setup.

### 1. Start infrastructure
```bash
supabase start                 # local Postgres :54322 (+ Studio :54323)
docker compose up -d redis     # Redis :6379
```

### 2. Configure `.env.local` (stub values are fine)
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
REDIS_URL=redis://127.0.0.1:6379
SLACK_API_BASE_URL=http://127.0.0.1:4010   # ⬅ slack-client talks to the stub
SLACK_BOT_TOKEN=xoxb-stub
SLACK_SIGNING_SECRET=stub-signing-secret
SLACK_CLIENT_ID=stub
SLACK_CLIENT_SECRET=stub
NEXTAUTH_SECRET=dev-secret
NEXTAUTH_URL=http://localhost:3000
INTERNAL_API_SECRET=dev-internal-secret
```
(Locally there is no Supabase pooler, so `DATABASE_URL` and `DIRECT_URL` are the same.)

### 3. Migrate, seed, run
```bash
pnpm db:migrate     # drizzle-kit against DIRECT_URL
pnpm seed           # 1 team, 1 member, 1 standup in a known state
pnpm dev            # web :3000, api :3001, worker, slack stub :4010
```

### 4. Test end-to-end
```bash
pnpm smoke:phase1   # runs smoke:db → auth → team → config → standup → edges
```
A green run means the full pipeline works: trigger → DM Q&A → post-as-user broadcast (asserted
against the stub's recorded calls) plus skip / skip-all / timeout edges. See the
[per-phase scenarios](../02_architecture/testing-and-local-dev.md#per-phase-smoke-scenarios-phase-1-core).

You can also click around the admin UI at `http://localhost:3000`.

### Run the standup worker (Step 5a)

The worker schedules and sends standup DMs via BullMQ. It needs Redis — which is already
started in step 1. Once the web app and worker are both running:

```bash
pnpm --filter @poddaily/worker dev   # boots the scheduler + DM worker
```

**Local demo walk:**
1. Make sure you have an active standup with at least one `can_report` member (the seed gives
   you this; or create one via the admin UI).
2. Note the standup's `id` (visible in the URL on the standup config page, or via the DB).
3. Trigger a run immediately (instead of waiting for the 00:05 daily tick):
   ```bash
   pnpm --filter @poddaily/worker trigger <standupId>
   ```
4. The worker opens a `standup_run` row and fans out a `send-standup-dm` job per member.
5. Against the stub: the Slack stub (`:4010`) records the `conversations.open` and
   `chat.postMessage` calls. Against a real Slack workspace: the member receives the intro
   message (if configured) + Q1 in a Slack DM.
6. Confirm a `standup_reports` row was created with `status = 'in_progress'` for that member.

**Smoke (automated):**
```bash
pnpm smoke:standup-outbound   # runs against real Redis + Slack stub
```
This boots a BullMQ queue+worker, triggers a run for the seeded standup, and asserts that
the stub received the expected Slack API calls and the DB has an `in_progress` report row.

> **`pnpm test` requires Redis up** (`docker compose up -d redis`) from Step 5a onwards.
> The `smoke:standup-outbound` suite runs as part of the default `vitest` run. This is a
> conscious choice, consistent with Postgres already being required for `pnpm test`.

### Step 5b — inbound DM Q&A

Once the api is running (it's part of `pnpm dev`, on `:3001`), replying to the standup DM
advances through the questions one at a time. `skip` records "(skipped)" and moves on;
`skip all` aborts the report. The full outbound→inbound round-trip is covered by:

```bash
pnpm smoke:standup            # outbound DM → full Q&A → completed report + outro
```

---

## Track B — Live end-to-end (real Supabase + real Slack)

Do this once per phase to validate against real Slack. Requires a Slack workspace where you
can install apps (use a **dev workspace**, not production).

### B1. Create the Supabase project (the database)
1. Create a project at <https://supabase.com> → set a strong DB password.
2. **Project Settings → Database → Connection string:**
   - **Transaction pooler** (port `6543`, host `...pooler.supabase.com`) → this is `DATABASE_URL`.
   - **Direct connection** (port `5432`, host `db.<ref>.supabase.co`) → this is `DIRECT_URL`.
3. Run migrations against it:
   ```bash
   DIRECT_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" pnpm db:migrate
   ```

### B2. Create the Slack app "poddaily"
1. <https://api.slack.com/apps> → **Create New App → From an app manifest** → select your dev
   workspace → paste `app_manifest.yaml` from the repo.
2. **OAuth & Permissions** — confirm scopes from the manifest:
   - **Bot Token Scopes:** `chat:write`, `chat:write.customize`, `im:write`, `im:history`,
     `users:read`, `users:read.email`, `channels:read`, `channels:history`, `groups:read`,
     `commands`.
   - **User Token Scopes:** `chat:write` (required for reporter post-as-user).
3. **Redirect URLs** (add both):
   - `https://<tunnel>/api/slack/oauth/callback` — reporter user-OAuth.
   - `https://<tunnel>/api/auth/callback/slack` — admin NextAuth login.
4. **Event Subscriptions** → enable → **Request URL:** `https://<tunnel>/api/slack/events`
   (must show "Verified") → **Subscribe to bot events:** `message.im`.
5. **Install to Workspace** → approve. Then collect credentials:
   - **OAuth & Permissions → Bot User OAuth Token** → `SLACK_BOT_TOKEN` (`xoxb-…`).
   - **Basic Information → App Credentials** → `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_ID`,
     `SLACK_CLIENT_SECRET`.
6. Invite the bot to the team's broadcast channel (`/invite @poddaily`).

> The `/standup` slash command is reserved for P1 — not required for Phase 1.

### B3. Start a tunnel (so Slack can reach your machine)
Slack must POST events to a public URL. Point a tunnel at the API (`:3001`) and use the same
host for the web auth callbacks, or run one tunnel per port:
```bash
ngrok http 3001          # → https://<tunnel> ; use this host in the Slack Request/Redirect URLs
```
Set `NEXTAUTH_URL` to the public web URL you expose.

### B4. Fill `.env.local` with real values
```
DATABASE_URL=postgresql://postgres:<pw>@<ref>.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
REDIS_URL=redis://127.0.0.1:6379
# real Slack values — and REMOVE SLACK_API_BASE_URL so slack-client hits slack.com
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>
NEXTAUTH_URL=https://<tunnel-web-host>
INTERNAL_API_SECRET=<random>
```

### B5. Run and walk the live runbook
```bash
docker compose up -d redis
pnpm db:migrate && pnpm seed
pnpm dev
```
Then follow the [live smoke runbook](../02_architecture/testing-and-local-dev.md#live-smoke-runbook-before-shipping-a-phase):
log in as admin, create a team, complete the reporter user-OAuth, trigger a run, answer in
Slack, and confirm the channel post is attributed to you, renders cleanly, and threads under
the opening message.

---

## Environment variable reference

| Var | Where it comes from | Track A (stub) | Track B (live) |
|---|---|---|---|
| `DATABASE_URL` | Supabase pooler (6543) / local | local `:54322` | Supabase pooled |
| `DIRECT_URL` | Supabase direct (5432) / local | local `:54322` | Supabase direct |
| `REDIS_URL` | Local Redis container | `redis://127.0.0.1:6379` | same |
| `SLACK_API_BASE_URL` | **Set** to point slack-client at the stub | `http://127.0.0.1:4010` | **unset** (→ slack.com) |
| `SLACK_BOT_TOKEN` | Slack → OAuth & Permissions | `xoxb-stub` | real `xoxb-…` |
| `SLACK_SIGNING_SECRET` | Slack → Basic Information | any string | real |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack → Basic Information | `stub` | real |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | any string | generated |
| `NEXTAUTH_URL` | Your web base URL | `http://localhost:3000` | tunnel/prod URL |
| `INTERNAL_API_SECRET` | You generate; worker↔api bearer + token-encryption key | any string | random secret |

---

## Troubleshooting

- **Slack Request URL won't verify** → API not reachable on the tunnel, or `SLACK_SIGNING_SECRET`
  mismatch. Confirm `ngrok` points at `:3001` and the secret matches the app.
- **Migrations fail on Supabase cloud** → you used the pooled URL; migrations need `DIRECT_URL`
  (5432, session mode). See [Supabase ADR](../03_decisions/2026-06-14-supabase-as-database.md).
- **Bot can't post to the channel** → invite it: `/invite @poddaily`.
- **Report posts as the bot, not as me** → reporter user-OAuth not completed; check for a
  `slack_user_tokens` row. Until connected, broadcast intentionally falls back to bot-posting
  (see [post-as-user ADR](../03_decisions/2026-06-14-post-as-user-tokens.md)).
- **`supabase start` port clash** → stop other local Postgres, or remap in `supabase/config.toml`.
