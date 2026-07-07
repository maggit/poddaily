# Contributing to poddaily

Thanks for your interest in contributing! poddaily is a self-hosted, Slack-native daily
standup bot, built in the open. Bug reports, feature ideas, docs improvements, and pull
requests are all welcome.

## Getting set up

**Prerequisites:** Node 22+, [pnpm](https://pnpm.io) 10 (`corepack enable` is the easiest
way), Docker (for Redis), and the [Supabase CLI](https://supabase.com/docs/guides/cli)
(for local Postgres).

Everything runs locally against a **stubbed Slack** — you don't need a Slack workspace,
app, or any external account to develop and test:

```bash
git clone https://github.com/maggit/poddaily.git
cd poddaily
pnpm install
cp .env.example .env.local        # stub values work locally
supabase start                    # local Postgres
docker compose up -d redis        # BullMQ broker
pnpm db:migrate && pnpm seed      # schema + known-state data
pnpm smoke:db                     # verify the foundation end-to-end
```

Then run whichever service you're working on:

```bash
pnpm --filter @poddaily/web dev      # admin web app → http://localhost:3000
pnpm --filter @poddaily/api dev      # Bolt service (inbound DM Q&A, slash command)
pnpm --filter @poddaily/worker dev   # scheduler + outbound standup DMs
```

To develop against a **real** Slack workspace instead, follow the complete runbook in
[Getting Started](ContextDB/00_index/getting-started.md).

## Project layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 admin app — auth, team/standup CRUD, reports dashboard |
| `apps/api` | Bolt (Hono/Node) service — inbound Slack events, DM Q&A engine, `/standup` |
| `apps/worker` | BullMQ worker — per-timezone scheduling, outbound DMs, reminders, timeouts |
| `packages/db` | Drizzle ORM schema, migrations, and data access |
| `packages/shared` | Cross-service logic (schedule math, DM engine state) |
| `tools/slack-stub` | Local fake of the Slack API used by dev and the smoke suites |
| `ContextDB/` | Project context: specs, architecture notes, and decision records (ADRs) |

Before working on anything substantial, skim the relevant spec and ADRs in
[`ContextDB/`](ContextDB/) — start at the
[project map](ContextDB/00_index/project-map.md). Most non-obvious behavior has a written
rationale there.

## Running the checks

```bash
pnpm check        # lint + typecheck
pnpm test         # lint + typecheck + full unit/integration suite
pnpm smoke:<area> # focused end-to-end suites: db, auth, team, config, standup, rbac, …
```

`pnpm test` needs **both Postgres and Redis** running (`supabase start` +
`docker compose up -d redis`). See [Testing & Local
Dev](ContextDB/02_architecture/testing-and-local-dev.md) for the full testing story,
including the live-workspace smoke runbook that gates each release phase.

## Making changes

1. **Fork and branch.** Branch from `main`; use a descriptive name like
   `feat/reminder-snooze` or `fix/timezone-rollover`.
2. **Keep PRs focused.** One logical change per PR — small PRs get reviewed fast.
3. **Add tests.** New behavior needs unit coverage; user-visible flows should extend the
   relevant `smoke:*` suite. `pnpm test` must be green.
4. **Follow the commit convention.** Conventional-commit style, matching the existing
   history: `feat(web): …`, `fix(worker): …`, `docs: …`, `chore: …`.
5. **Update the docs.** If your change affects setup, configuration, or user-facing
   behavior, update the README (and the relevant `ContextDB/` doc) in the same PR.

Not sure where to start? Check the [roadmap](README.md#roadmap) and the
[open issues](https://github.com/maggit/poddaily/issues) — or open an issue to discuss an
idea before building it.

## Reporting bugs

Open a [GitHub issue](https://github.com/maggit/poddaily/issues) with steps to reproduce,
what you expected, and what happened. Logs from the affected service (`web`, `api`, or
`worker`) help a lot.

**Security issues:** please do **not** open a public issue. Use
[GitHub's private vulnerability reporting](https://github.com/maggit/poddaily/security/advisories/new)
so we can fix it before disclosure.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
