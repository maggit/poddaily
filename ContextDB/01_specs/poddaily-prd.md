# PRD: poddaily

> Captured from `PRD_poddaily.docx` v1.0. This is the product source of truth.
> Implementation scope and resolved open questions live in
> [Phase 1 Core spec](phase-1-core-spec.md).

- **Version:** 1.0
- **Owner:** Raquel Hernandez, VP Engineering
- **Status:** Ready for Engineering

## Problem statement

Engineering teams lack a lightweight, self-hosted standup automation tool that fits the
Pod Model org structure. Existing hosted SaaS standup tools are functional but are
third-party with per-seat costs, no deep integration with internal tooling, and no admin
control layer for managing 30+ pods across 8 tribes. Teams need a Slack-native standup bot
where each team (pod) has its own members, a dedicated broadcast channel, and a configurable
daily standup — all managed through an internal admin platform.

poddaily is the self-hosted, open-source replacement: a Slack-native standup bot plus an
internal admin platform, designed to run on internal infrastructure with no per-seat cost.

## Goals

- Replace the hosted SaaS standup tool with a self-hosted bot, eliminating per-seat SaaS cost.
- Any EM/admin can create a standup for a team in under 5 minutes.
- 70%+ daily participation rate per active team within 30 days of rollout.
- Post standup updates to the team's Slack channel attributed to the user, matching the
  reference UX.
- Surface participation and blocker data pipeable into the Databricks observability pipeline.

## Non-goals

- Cross-team analytics dashboard (v1) — raw export is enough; analytics on Databricks.
- Multiple standups per team — one standup per pod (multi-standup is v2).
- Non-Slack delivery (email, SMS) — Slack-only.
- Mobile admin app — admin platform is web-only.
- Paid/external user access — internal engineers only, no multi-tenant.

## Technology stack

| Layer | Technology | Rationale |
|---|---|---|
| Admin UI | Next.js 15 (App Router) | Modern, SSR, fast DX |
| API | Hono.js on Node 22 | Lightweight, typed |
| Worker | BullMQ + Redis | Cron scheduling, retry, job queues |
| Database | PostgreSQL 16 (via **Supabase**) | Relational, strong consistency, managed |
| ORM | Drizzle ORM | Type-safe, no magic SQL |
| Auth | NextAuth v5 (Slack OAuth) | SSO via Slack |
| Styling | Tailwind CSS + shadcn/ui | Modern, consistent, fast |
| Deployment | Dokploy on ROSA/EKS | Internal PaaS |
| Slack SDK | @slack/bolt | Official Events API + commands |

## Requirements summary

### P0 — Must have (v1)

**Admin platform:** Slack OAuth auth · team CRUD (name, channel picker, tribe) · member
management with per-member permissions (view/report/edit) · standup config (questions
add/remove/reorder, schedule day+time+TZ, intro/outro) · today's dashboard (participation,
reporters vs non-reporters, inline answers) · one-click reminders · standup pause/resume.

Default questions: "What have you done since {last_report_date}?", "What will you do today?",
"Anything blocking your progress?", "How do you feel today?"

**Slack bot:** workspace install via OAuth · daily DM initiation at configured time ·
conversational one-question-at-a-time Q&A (free-text) · channel broadcast of a formatted
summary attributed to the user · thread grouping under a daily opening message ·
`{last_report_date}` interpolation · timeout handling (incomplete after 4h, no partial post)
· skip / skip all.

**Worker:** BullMQ cron per active standup · retry failed DMs 3× exponential backoff ·
reminder job 2h after start for non-reporters.

### P1 — Nice to have (v1.1)

Analytics tab · `/standup` slash command · blocker aggregation · team happiness widget ·
streak tracking · Databricks export webhook · tribe-level rollup.

### P2 — Future

Multiple standups per team · poll/survey support · AI summarization · OOO detection
(Google Calendar) · migration script from a prior standup tool.

## Slack message format

**Opening thread message:**
```
📋 *Daily Standup — {date}*
Find all reports for *Daily Standup, {date}* in this thread.
Reported: {n} out of {total}
```

**Individual report (threaded reply, attributed to the user):**
```
*{User Full Name}* posted an update for Daily Standup
  | *What have you done since {last_report_date}?*
  | {answer}
  | *What will you do today?*
  | {answer}
  | *Anything blocking your progress?*
  | {answer}
  | *How do you feel today?*
  | {answer}
```

Use Block Kit: section blocks with mrkdwn header, divider, then sequential section blocks
per Q&A pair.

## Success metrics

**Leading (2 weeks):** ≥5 teams onboarded · ≥70% daily participation · ≥99% DM delivery
success · admin setup ≤5 min.

**Lagging (60 days):** prior SaaS standup contract cancelled · zero standup support requests to
#eng-platform · standup data flowing into Databricks via export webhook.

## Open questions

| # | Question | Owner | Blocking? | Resolution |
|---|---|---|---|---|
| 1 | Post via `chat:write.customize` or user tokens? | Engineering | Yes | **User tokens** — see [ADR](../03_decisions/2026-06-14-post-as-user-tokens.md) |
| 2 | Team-level vs per-user timezone? | Raquel | Yes | **Per-user TZ** — see [ADR](../03_decisions/2026-06-14-per-user-timezone.md) |
| 3 | Admin access for all engineers or EMs/directors only? Define RBAC. | Raquel | No | **Open** — Phase 1 default: anyone who can Slack-OAuth is an admin |
| 4 | New Slack app or add to existing internal app? | Raquel + Security | Yes | **New app** — see [ADR](../03_decisions/2026-06-14-new-slack-app.md) |
| 5 | Migrate data from the prior standup tool? | Raquel | No | **Open** — deferred (P2 migration script) |
| 6 | Compliance constraints on stored answers (sec-compliance-ops channel)? | Security/Compliance | No | **Open** — to confirm before storing security-team data |

## Timeline (from PRD)

| Phase | Scope | Target |
|---|---|---|
| 1 — Core | Auth, team CRUD, standup config, Slack DM flow, channel broadcast, scheduler | 3 weeks |
| 2 — Admin UX | Dashboard, participation stats, reminders, pause/resume | +1 week |
| 3 — Polish + launch | Dokploy deploy, env config, docs, pilot with 2–3 teams | +1 week |
| 4 — P1 features | Analytics, slash command, Databricks webhook, streaks | +2 weeks |

Total to v1 launch: ~5 weeks.
