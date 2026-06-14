# ADR: Per-user local timezone scheduling

- **Date:** 2026-06-14
- **Status:** Accepted
- **Resolves:** PRD Open Question #2 (blocking)

## Context

The standup DM must reach each member at an appropriate local time. Options:

1. **Team-level timezone** — one TZ per standup (default `America/Mexico_City`); everyone is
   DM'd at the same instant. Simple scheduler and data model. PRD recommendation.
2. **Per-user local timezone** — each member is DM'd at their own local time. Requires
   storing each member's TZ and computing per-member send instants.

## Decision

Use **per-user local timezone** (option 2).

## Consequences

- `team_members.timezone` (IANA) is captured, seeded from Slack `users.info.tz` when a member
  is added. `standups.schedule_tz` becomes the **fallback** when a member has no TZ.
- The scheduler opens a run, then fans out one `send-standup-dm` per member computed against
  that member's local send time — a run can DM members across the day as each local time
  arrives. See [scheduler](../02_architecture/scheduler.md).
- The local-send-instant computation is a pure, unit-tested function (including DST edges).
- More complex than team-level, but better participation UX for distributed pods.

## Alternatives considered

- **Team-level TZ** — simpler, but a single global fire mismatches distributed members'
  working hours.
