# 2026-06-26 — Inactivity-based standup timeout (bug fix)

A member who answered standup questions over a span of hours got cut off mid-conversation — the
bot went "stale" and silently ignored their next reply. This makes the per-report timeout an
**inactivity** timeout. Spec:
[2026-06-26-inactivity-timeout-design.md](../../docs/superpowers/specs/2026-06-26-inactivity-timeout-design.md).
Plan: [2026-06-26-inactivity-timeout.md](../../docs/superpowers/plans/2026-06-26-inactivity-timeout.md).

## The bug

The per-report timeout was a **fixed deadline anchored to when the DM was sent** (`sendDm` enqueued
a `timeout-report` at `send + STANDUP_TIMEOUT_MS`) and was **never re-armed** when the member
replied. So if the gap between the DM being sent and the member finishing exceeded the timeout —
e.g. they opened the DM a few hours late — the report flipped to `timed_out` mid-conversation. Once
`timed_out`, `handleMessage`'s `status = 'in_progress'` lookup found nothing, so the next reply was
dropped. The reminders/re-trigger features didn't cause it; it was the original Step 7 timeout
design.

## The fix

- **`standup_reports.timeout_at`** (`timestamptz`, nullable) — migration `0004_dashing_sumo.sql`.
  The absolute inactivity deadline.
- **Set on report creation** — `sendDm` and `retrigger` stamp `timeout_at = now + timeoutMs` when
  inserting/resetting the report (`timeoutMs` moved above the insert).
- **Bumped on every answer** — `handleMessage`'s `next` branch now sets
  `timeout_at = now + STANDUP_TIMEOUT_MS` alongside saving the answer (the api reads the env, same
  4h default). The api does **not** enqueue anything — it only writes the new deadline.
- **Self-rescheduling `timeoutReport`** — when the timeout job fires it re-reads `timeout_at`; if
  the deadline has moved into the future (the member replied since), it **re-enqueues itself** for
  the remaining delay instead of timing out. Past deadline (or `timeout_at` null for a legacy row)
  → `timed_out` + finalize. So one timeout job per report chases the latest deadline; it only fires
  for real after a full window of silence. `timeoutReport` gained an `enqueueTimeout` dependency.

## Verification

- `pnpm test` — **156 passed / 156** (36 files), 0 failures (migration applied first).
- New/updated tests: `timeoutReport` (reschedule on future deadline; time out on past/null; no-op on
  completed); `handleMessage` (an advancing answer bumps `timeout_at` into the future); `sendDm` +
  `retrigger` (a new/reset report has `timeout_at` set).

## Notable decisions

- **Inactivity reset** (full window from last reply), not a longer fixed-from-send window.
- **Global env** `STANDUP_TIMEOUT_MS` (api reads it too), not a per-standup column — focused fix.
- **Self-rescheduling handler** keeps exactly one timeout job per report; the api stays out of the
  queue for this (only writes `timeout_at`).
- **Deadline race** (job fires the instant a reply lands) is accepted: tiny, and only at the far
  edge of an inactivity deadline — a huge improvement over the previous guaranteed cutoff.

## Definition of done

1. New/updated unit tests + full `pnpm test` green; migration `0004` applies.
2. README `STANDUP_TIMEOUT_MS` note updated (inactivity semantics + api-also-needs-it) ✅;
   this build log ✅.
3. No Slack config change; one schema column (`timeout_at`).
4. **Deploy:** migration `0004` runs automatically on `web` boot; **set `STANDUP_TIMEOUT_MS` on the
   `api` service** (same value as `worker`).
