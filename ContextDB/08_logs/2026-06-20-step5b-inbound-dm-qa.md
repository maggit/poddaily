# 2026-06-20 — Step 5b Build: Inbound DM Q&A Engine

Executed the [Step 5b plan](../todos/2026-06-19-phase1-step5b-inbound-dm-qa-plan.md) on
branch `feat/step5b-inbound-dm-qa`. Members now answer their standup one question at a time in
the DM, with `skip` / `skip all` controls, completing to a `completed` report + outro.

## What shipped

- **`apps/api`** — new service running `@slack/bolt` (named `import { App }` from `@slack/bolt`
  v4). It receives `message.im` events and delegates to `handleMessage`, which reconstructs
  progress statelessly from `standup_reports.answers` (per the
  [stateless-DM ADR](../03_decisions/2026-06-14-stateless-dm-state.md)), persists each answer,
  posts the next question, and on the last question marks the report `completed` and posts the
  outro to the DM.
- **Controls.** `skip` records "(skipped)" and advances; `skip all` aborts the report to
  `timed_out` and ends. (The TIME-BASED 4h timeout sweeper is **not** in 5b — that's Step 7.
  The CHANNEL BROADCAST is **not** in 5b — that's Step 6. On completion, 5b posts the outro to
  the DM only.)
- **`packages/shared` — `advanceReport`** — the pure DM Q&A reducer, lives in
  `packages/shared/src/dmEngine.ts`, TDD'd with 9 tests covering answer/skip/skip-all/complete
  plus empty-questions noop and whitespace-only answers.
- **`smoke:standup`** — root script: end-to-end outbound (real BullMQ worker + Redis + Slack
  stub) → inbound full Q&A → `completed` + outro. Drives the tested `handleMessage` seam
  directly.
- **Production deploy plumbing** — `Dockerfile.api`, `Dockerfile.worker` (both run via `tsx`),
  and `docker-compose.dokploy.yml` now activates `redis` + `api` + `worker` services. Both
  images build + boot verified. The api needs `SLACK_SIGNING_SECRET` at boot (in addition to
  `SLACK_BOT_TOKEN`, `DATABASE_URL`, `REDIS_URL`).

## Verification

- `pnpm test`: **20 files / 74 tests passing** (unit + integration, including the
  `smoke:standup-outbound` suite that runs as part of the default `vitest` run).
- `pnpm smoke:standup`: green — outbound run → inbound full Q&A through `handleMessage` →
  `completed` report + outro posted to the DM.
- Both Docker images (`Dockerfile.api`, `Dockerfile.worker`) build and boot via `tsx`.
  **Correction (see post-merge fix below):** this was first verified against a *dirty* local
  build context whose `node_modules` masked a missing runtime dependency. A clean-clone build
  (Dokploy) failed at boot until the Dockerfiles were fixed.

## Notable decisions / scope

- **Stateless reducer in `shared`.** `advanceReport` is a pure function — no DB, no Slack —
  so the engine's decision logic is unit-tested in isolation. `handleMessage` owns the I/O.
- **`handleMessage` DI mirrors `sendDm`.** The inbound orchestrator takes its dependencies
  (db, slack client) by injection, the same shape as the outbound `sendDm`, so smoke can drive
  the tested seam directly.
- **`skip all` → `timed_out` is the only abort in 5b.** There is no other terminal-abort path
  yet; the time-based 4h timeout sweep is **Step 7**.
- **Broadcast → Step 6, 4h timeout → Step 7.** On completion 5b posts the outro to the DM
  only; the channel broadcast (post-as-user) and the timeout sweeper are still pending.
- **api needs `SLACK_SIGNING_SECRET` at boot** for Slack request-signature verification, in
  addition to `SLACK_BOT_TOKEN` / `DATABASE_URL` / `REDIS_URL`.
- **Bolt v4** — used the named `import { App } from '@slack/bolt'`.

## Definition of done — honest status

- Automated `smoke:standup` (+ unit + integration) green in CI — ✓
- Root `README.md` updated (feature checklist ticked for DM Q&A without the timeout claim;
  inbound api section, testing line, deployment services) — ✓
- Affected `ContextDB/` docs updated (getting-started 5b note, slack-integration status, this
  log) — ✓
- **Live smoke runbook against a real Slack dev workspace — walked 2026-06-20.** ✓ Deployed the
  full stack to Dokploy + Supabase + Cloudflare (`api.poddaily.io`), triggered a run, received
  the intro + Q1 DM, answered all 4 questions one-at-a-time, and the report completed with the
  outro (`standup_reports.status = completed`, `answers` length 4). Gotchas hit and fixed along
  the way are captured in [deployment-dokploy.md](../02_architecture/deployment-dokploy.md#production-gotchas-learned-walking-the-step-5b-live-deploy)
  (leftover `SLACK_API_BASE_URL`, the Slack Messages-tab reply toggle, the Dockerfile
  node_modules fix above, team-id-vs-standup-id, standalone-vs-Compose Redis networking).
- **Dokploy production deploy — done 2026-06-20.** ✓ web + api + worker + redis live.

So Step 5b is **fully shipped**: CI-green *and* verified end-to-end against a real Slack
workspace in production. The per-phase Definition of Done is complete.

## Post-merge deploy fixes (2026-06-20)

Found while standing the stack up on Dokploy, after the branch merged to `main`.

- **`ERR_MODULE_NOT_FOUND: drizzle-orm` at api boot on Dokploy** (fix: `15d74cc`). The runner
  stages of `Dockerfile.api` / `Dockerfile.worker` copied `packages/*` **source** from the
  build context but only `apps/<svc>/node_modules` from the deps stage — so each workspace
  package's own deps (`drizzle-orm`, `postgres`, `luxon`, `@slack/web-api`) were absent in the
  image. Local builds passed only because the dev tree's `node_modules` got swept in by `COPY`;
  a clean Dokploy/CI clone has none. Fix: copy `packages/<p>/node_modules` from the deps stage,
  and add a **`.dockerignore`** (excluding `node_modules`) so local builds match a clean clone
  and can't mask this again. Both images re-verified building + booting in a clean context.
  Lesson: the Task-6 review built in a dirty context — Docker builds must be validated with
  `node_modules` excluded from the context.
- **Slack event Request URL is `/slack/events`, not `/api/slack/events`.** Bolt v4's default
  HTTP receiver serves `/slack/events`; the deployment doc had the wrong path (now corrected in
  [deployment-dokploy.md](../02_architecture/deployment-dokploy.md)).

## Out of scope (not done in 5b)

- Channel broadcast / post-as-user → Step 6.
- 4h timeout sweeper → Step 7.

Next: Step 6 — channel broadcast (post-as-user), threaded under the daily opening message.
