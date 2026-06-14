# 2026-06-14 — Planning Session

First planning session for poddaily. Read the PRD (`PRD_poddaily.docx`), reviewed the
reference UX screenshots, resolved blocking open questions, and produced the Phase 1 Core
design + this ContextDB doc set.

## Inputs

- `PRD_poddaily.docx` v1.0 (captured to [PRD](../01_specs/poddaily-prd.md)).
- 5 reference UX screenshots (standup edit page, participants/permissions, channel
  config, dashboard insights, standup list). Detailed visual/styling direction to be
  supplied by the owner later.

## Decisions made

| Decision | Choice | Notes |
|---|---|---|
| Plan scope | **Phase 1 Core only** | Tightest buildable first spec |
| Channel attribution | **User tokens (post-as-user)** | Overrode PRD's pragmatic `chat:write.customize` recommendation |
| Scheduling TZ | **Per-user local timezone** | Overrode PRD's team-level recommendation |
| Slack app | **New app "poddaily"** | Pending Security sign-off |
| Database | **Supabase managed Postgres** (DB only) | Keep NextAuth; not Supabase Auth/RLS |
| Workers/queue | **Self-hosted Redis** + BullMQ | Supabase has no Redis |
| Build order | **Vertical slice first** | De-risk Slack + scheduler early |
| DM state | **Stateless, reconstructed from Postgres** | No Redis conversation store |
| Per-phase E2E testing | **Smoke test via Slack stub + live runbook** | Hybrid; CI-deterministic |
| Local DB for dev/tests | **Supabase CLI local** | Prod parity |

ADRs written for each in [`03_decisions/`](../03_decisions/).

## Outputs (this session)

- `00_index/project-map.md`
- `01_specs/poddaily-prd.md`, `01_specs/phase-1-core-spec.md`
- `02_architecture/`: system-overview, data-model, slack-integration, scheduler,
  testing-and-local-dev
- `03_decisions/`: 7 ADRs (post-as-user, per-user-TZ, new-app, supabase, vertical-slice,
  stateless-DM, e2e-smoke-with-slack-stub)
- `07_diagrams/`: architecture, dm-state-machine, scheduler-flow
- Root `CLAUDE.md` with the ContextDB routing snippet
- `git init` (branch `main`)

## Still open (non-blocking)

- **RBAC (PRD Q3):** Phase 1 default = anyone who can admin-Slack-OAuth is an admin.
- **Prior-tool data migration (PRD Q5):** deferred (P2).
- **Compliance on stored answers (PRD Q6):** confirm with Security before storing
  security-team standup data (may affect retention/encryption of `standup_reports.answers`).
- **Visual/styling direction:** owner to provide; spec keeps styling a thin layer.

## Next step

Owner reviews the spec. On approval, transition to writing the implementation plan
(writing-plans) for Phase 1 Core following the vertical-slice build order.
