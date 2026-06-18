# Step 5a — Scheduler + outbound standup DM (design)

> Validated design for the first half of Phase 1 Step 5. Step 5 ("Scheduler →
> `send-standup-dm` → DM Q&A engine", the front-loaded core risk) is split into **5a
> (this doc)** and **5b** (inbound DM Q&A engine), mirroring how Step 3 was split.
> Source of truth for scope: [phase-1-core-spec](../../../ContextDB/01_specs/phase-1-core-spec.md),
> [scheduler](../../../ContextDB/02_architecture/scheduler.md),
> [slack-integration](../../../ContextDB/02_architecture/slack-integration.md).

## 1. Goal & scope

5a delivers the **outbound** half of the standup loop: a per-user-timezone scheduler that
opens a daily run and DMs every reporting member their intro + first question. No inbound
reply handling — that is 5b.

**Demoable outcome:** trigger a standup → every `can_report` member receives a real Slack DM
(intro + interpolated Q1) at their local send time, and a `standup_reports` row exists with
`status=in_progress`.

### In 5a

- New app `apps/worker` — BullMQ scheduler + job processors.
- New package `packages/slack-client` — thin `@slack/web-api` wrapper honoring
  `SLACK_API_BASE_URL`.
- `tools/slack-stub` extended to fake `conversations.open` + `chat.postMessage` and record
  sent messages.
- `packages/shared` gains the pure send-instant computation (Luxon-based) + reconcile diff.
- DB migration: idempotency constraints on `standup_runs` and `standup_reports`.
- Unit + integration tests + `smoke:standup-outbound`; local demo runbook.

### Deferred

| Deferred to 5b | Deferred to step 6 / 7 |
|---|---|
| `apps/api` (Hono) + Slack events/interactions receiver | Channel broadcast / post-as-user (step 6) |
| Inbound `message.im` → state reconstruction → advance | `complete-run` job + 4h timeout sweeper (step 7) |
| `complete` + outro post | Retry-policy hardening / skip / skip-all (step 7) |
| Full `smoke:standup`; web-write → reconcile trigger | Prod deploy of worker + Redis to Dokploy |

**Why `apps/api` is not in 5a:** `apps/api` exists to receive Slack *events*. 5a sends only,
so the worker opens runs by writing to `@poddaily/db` directly and sends DMs via the bot token
through `slack-client`. `apps/api` earns its place in 5b. (Consistent with the
[admin-CRUD ADR](../../../ContextDB/03_decisions/2026-06-16-admin-crud-via-next-server.md).)

## 2. Architecture

```
apps/worker/             BullMQ scheduler + job processors (only new app in 5a)
packages/slack-client/   Thin wrapper over @slack/web-api; honors SLACK_API_BASE_URL
packages/shared/         + sendInstants.ts (pure), + reconcile diff helper
tools/slack-stub/        + conversations.open, chat.postMessage, recorder, reset
```

Runtime deps: Supabase Postgres (already used), **self-hosted Redis** (new — BullMQ), Slack API.

## 3. Data flow (one run)

```
repeatable job  (one per active standup, keyed by standup.id, cron tz = scheduleTz)
  └─ fires 00:05 in scheduleTz on each active weekday  ──▶  openRun(standupId, now)
       1. guard: is `now`'s date (in scheduleTz) an active weekday? if not, no-op.
       2. insert standup_runs (status=running, scheduledAt=now, scheduledDate=<date in scheduleTz>)
          — unique (standup_id, scheduled_date) makes this one-run-per-day, idempotent.
       3. load can_report members + timezone (fallback standups.scheduleTz).
       4. for each member: computeSendInstant(cron, memberTz, anchorDate)
            • now-or-past (within tolerance) → enqueue send-standup-dm now
            • later today                    → enqueue send-standup-dm delayed
       (complete-run / timeout sweeper → step 7)

send-standup-dm  (one per member; BullMQ retries 3× exponential backoff)
  └─ slack-client.conversations.open({ users: slackUserId }) → channelId
     interpolate {last_report_date} into Q1
     if introMessage present → chat.postMessage(intro)
     chat.postMessage(Q1)
     upsert standup_reports (run_id, slack_user_id) status=in_progress, answers=[], dmThreadTs
       — unique (run_id, slack_user_id) makes retry safe (onConflictDoNothing).
```

## 4. Locked decisions

### 4.1 Canonical date anchor + active-weekday timezone (core correctness)

- A run is for **calendar date D in the standup's `scheduleTz`**.
- "Is today an active weekday?" is evaluated **once, in `scheduleTz`** — not per member.
- Each member is then DM'd at **their own local configured time on that same date D**.
- Consequence: a member far enough east/west may receive their DM slightly before/after their
  local wall-clock time on edge days, but **everyone gets exactly one DM per run** and the
  active-weekday set is unambiguous. Evaluating weekday per-member (the rejected alternative)
  produces split/double runs.

### 4.2 Idempotency schema deltas (land in the 5a migration)

- `standup_runs`: add `scheduled_date DATE` + **unique `(standup_id, scheduled_date)`**.
- `standup_reports`: add **unique `(run_id, slack_user_id)`** so `send-standup-dm` upserts
  (`onConflictDoNothing`) instead of double-inserting on retry.

### 4.3 Tick reference time

- The per-standup repeatable job fires at **00:05 in `scheduleTz`** on active weekdays
  (BullMQ cron `tz` option). Comfortably before any same-date local send instant, so member
  offsets are always ≥ 0.
- The repeatable cron is **derived** from `standups.scheduleCron`: reuse its day-of-week field,
  override the hour/minute to `5 0`. The standup's *actual* configured time (e.g. 09:00) is used
  only by `computeSendInstant` for the per-member offset — never by the tick itself.

### 4.4 Scheduler timing model

- **One repeatable job per active standup**, keyed by `standup.id`. It opens the run and fans
  out per-member `send-standup-dm` jobs (immediate or `delayed`). Chosen over earliest-member
  cron (fragile reconcile) and a global tick scanner (couples granularity to interval).

### 4.5 Reconciliation

- `reconcileSchedules()` runs on **worker boot** and is exported. It diffs `is_active` standups
  against existing repeatable jobs: add missing, remove stale, recreate on `schedule_cron` /
  `schedule_tz` / `is_active` change.
- 5a wires **boot-time reconcile + an explicit reconcile entrypoint**. The web standup-config
  write → reconcile trigger is wired in 5b when `apps/api` / internal endpoints exist.

### 4.6 Defaults / null handling

- `{last_report_date}` ← the member's most recent `completed` report date; no history →
  `"last time"`.
- Null `introMessage` → skip the intro post, send Q1 alone.
- Null member `timezone` → fall back to `standups.scheduleTz`.

### 4.7 Library

- **Luxon** for cron + IANA-tz + DST math. Chosen over hand-rolled `Intl.DateTimeFormat`
  (error-prone at DST edges).

### 4.8 Concurrency

- Single worker replica assumed for now (matches the single web replica). The unique
  constraints (4.2) are the safety net if replicas are ever added.

## 5. The Slack boundary

### `packages/slack-client`

```ts
createSlackClient({ token, baseUrl = process.env.SLACK_API_BASE_URL })
  .conversations.open({ users })                  → { channelId }
  .chat.postMessage({ channel, text, blocks? })   → { ts }
```

- `baseUrl` defaults to Slack; tests/smoke point it at the stub (same mechanism the auth step
  uses).
- Phase-1 surface is intentionally tiny: `conversations.open` + `chat.postMessage`. User-token
  posting + threading land in 5b/6.
- Slack API errors surface as typed failures so `send-standup-dm` lets BullMQ retry.

### `tools/slack-stub` extension

- `POST /api/conversations.open` → `{ ok:true, channel:{ id:"D<userhash>" } }`.
- `POST /api/chat.postMessage` → `{ ok:true, ts:"<incrementing>" }`, recording
  `{ channel, text, blocks }`.
- `GET /__stub/messages` → recorded log (tests assert intro + interpolated Q1 per member).
- Reset hook between tests.

## 6. Demo & test seam

The worker exposes `openRun(standupId, now)` and a CLI:

```
pnpm --filter @poddaily/worker trigger <standupId>   # opens a run now, fans out
```

Both the local runbook and the integration test call this — no waiting on cron. The
repeatable-cron wiring (reconcile + tick) is covered by a separate fast unit test.

### Local demo runbook (added to getting-started)

1. `docker compose up redis` (new compose service).
2. Use the **existing test team with one member (the operator)** + an active standup.
3. `pnpm --filter @poddaily/worker dev`, then `… trigger <standupId>`.
4. Member receives intro + Q1 in Slack; `standup_reports` row is `in_progress`. (Against the
   stub in CI; against a real dev workspace for the live walk.)

## 7. Testing

- **Unit (front-loaded core):** `packages/shared/sendInstants.test.ts` — `computeSendInstant`
  across timezones; DST spring-forward / fall-back; date-anchor edges (member east/west of
  `scheduleTz`); inactive weekday → no send. `reconcileSchedules` diff (add/remove/recreate)
  with a fake queue.
- **Integration:** `openRun(standupId, now)` against local Postgres + stub — one `standup_runs`
  row, N `in_progress` reports, stub recorded intro + interpolated Q1 per member. Re-running
  `openRun` for the same day inserts nothing new (proves the unique constraints).
- **Smoke:** new `smoke:standup-outbound` in `package.json`, CI with ephemeral Redis + stub,
  no secrets. The full `smoke:standup` keystone completes in 5b.

## 8. Environment variables (5a)

```
REDIS_URL=redis://...        # BullMQ (already in the Phase-1 env list)
SLACK_BOT_TOKEN=xoxb-...     # already specced; now actually consumed
SLACK_API_BASE_URL=...       # tests/smoke → stub; unset in prod
```

No new secrets beyond the Phase-1 env list.

## 9. Definition of done (5a)

- `smoke:standup-outbound` green in CI (with unit + integration).
- Local demo runbook walked once against the real dev workspace test team.
- Root `README.md` feature checklist + setup updated (Redis dependency, worker run).
- `ContextDB/` updated: scheduler.md (anchor/tick decisions), getting-started runbook,
  project-map (Step 5a status), a build log in `08_logs/`.

> Note: prod deploy of the worker + Redis provisioning on Dokploy is intentionally **out of
> 5a** and bundled with 5b, when the full trigger → reply → broadcast pipeline is live and
> there is an end-to-end thing to watch.
