# Data Model

Postgres 16 (Supabase), accessed via Drizzle ORM. Base schema is from the
[PRD](../01_specs/poddaily-prd.md); this document is the authoritative version including
Phase 1 deltas.

## Tables

### `teams` (pods)
```sql
id UUID PK DEFAULT gen_random_uuid()
name TEXT NOT NULL
slack_channel_id TEXT NOT NULL UNIQUE
slack_channel_name TEXT NOT NULL
tribe TEXT
created_at / updated_at TIMESTAMPTZ DEFAULT NOW()
```

### `team_members`
```sql
id UUID PK
team_id UUID REFERENCES teams(id) ON DELETE CASCADE
slack_user_id TEXT NOT NULL
slack_display_name TEXT NOT NULL
slack_avatar_url TEXT
timezone TEXT                 -- ⬅ DELTA: IANA TZ from Slack users.info.tz, drives scheduler
can_report BOOLEAN DEFAULT TRUE
can_view BOOLEAN DEFAULT TRUE
can_edit BOOLEAN DEFAULT FALSE
created_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE(team_id, slack_user_id)
```

### `standups` (one per team)
```sql
id UUID PK
team_id UUID REFERENCES teams(id) ON DELETE CASCADE UNIQUE
name TEXT NOT NULL DEFAULT 'Daily Standup'
questions JSONB NOT NULL       -- ordered array of {id, text, hint, type}
schedule_cron TEXT NOT NULL    -- e.g. "0 10 * * 1-5" (interpreted per-member-TZ)
schedule_tz TEXT NOT NULL DEFAULT 'America/Mexico_City'  -- fallback when a member has no TZ
intro_message TEXT
outro_message TEXT
is_active BOOLEAN DEFAULT TRUE
created_at / updated_at TIMESTAMPTZ DEFAULT NOW()
```

### `standup_runs` (each scheduled execution)
```sql
id UUID PK
standup_id UUID REFERENCES standups(id)
scheduled_at TIMESTAMPTZ NOT NULL
started_at / completed_at TIMESTAMPTZ
status TEXT DEFAULT 'pending'  -- pending | running | completed | failed
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `standup_reports` (one per user per run)
```sql
id UUID PK
run_id UUID REFERENCES standup_runs(id)
slack_user_id TEXT NOT NULL
slack_display_name TEXT NOT NULL
answers JSONB NOT NULL          -- [{question_id, question_text, answer}] — progress source of truth
status TEXT DEFAULT 'in_progress'  -- ⬅ DELTA: in_progress | completed | timed_out
dm_thread_ts TEXT               -- Slack ts for the DM conversation
channel_post_ts TEXT            -- Slack ts of the posted summary in channel
reported_at TIMESTAMPTZ DEFAULT NOW()
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `slack_user_tokens` ⬅ DELTA (new table)
```sql
slack_user_id TEXT PRIMARY KEY
access_token TEXT NOT NULL      -- encrypted at rest (AES-GCM, key derived from INTERNAL_API_SECRET)
scopes TEXT NOT NULL            -- granted user scopes, e.g. "chat:write"
authed_at TIMESTAMPTZ DEFAULT NOW()
```
Stores the per-reporter Slack **user token** used to post reports as the user. See
[post-as-user ADR](../03_decisions/2026-06-14-post-as-user-tokens.md).

### `app_users` ⬅ DELTA (new table — Phase 2-D)
```sql
slack_user_id   TEXT PRIMARY KEY            -- Slack user_id (session sub); consistent with team_members + slack_user_tokens
email           TEXT
display_name    TEXT
avatar_url      TEXT
role            user_role NOT NULL DEFAULT 'viewer'  -- ENUM: 'viewer' | 'manager' | 'admin'
created_at      TIMESTAMPTZ DEFAULT NOW()
last_login_at   TIMESTAMPTZ
```
Stores every admin-portal user and their global role. The row is upserted on each Slack OAuth
login (refreshing `display_name`, `email`, `avatar_url`, `last_login_at`; role is preserved for
existing users). **Distinct from `team_members`:** `team_members` = people who report in
standups; `app_users` = people who log into the admin dashboard. Someone can be in both.

See the [bootstrap / auto-provision rules](2026-06-26-rbac-role-tiers.md#3-bootstrap-first-login-while-zero-admins-exist--admin)
and [RBAC ADR](../03_decisions/2026-06-26-rbac-role-tiers.md).

### `team_managers` ⬅ DELTA (new table — Phase 2-D)
```sql
id              UUID PK DEFAULT gen_random_uuid()
team_id         UUID REFERENCES teams(id) ON DELETE CASCADE
slack_user_id   TEXT REFERENCES app_users(slack_user_id) ON DELETE CASCADE
created_at      TIMESTAMPTZ DEFAULT NOW()
UNIQUE(team_id, slack_user_id)
```
Many-to-many join: records which `manager`-role users own which teams. A manager can own
multiple teams; a team can have multiple managers. **Distinct from `team_members`:**
`team_members` = standup reporters for that team; `team_managers` = dashboard administrators
(the `manager` role tier) who may edit that team's config, members, and standup. Assignment is
a two-step admin action: promote the user to `manager` on the People page, then assign to teams.

### `standup_reminders` (log; Phase 2 usage)
```sql
id UUID PK
run_id UUID REFERENCES standup_runs(id)
slack_user_id TEXT NOT NULL
sent_at TIMESTAMPTZ DEFAULT NOW()
type TEXT DEFAULT 'initial'     -- initial | reminder
```

## Deltas from the PRD — why

| Delta | Reason |
|---|---|
| `team_members.timezone` | Per-user-TZ scheduling needs each member's IANA zone ([ADR](../03_decisions/2026-06-14-per-user-timezone.md)) |
| `slack_user_tokens` table | Post-as-user requires storing each reporter's user token, encrypted ([ADR](../03_decisions/2026-06-14-post-as-user-tokens.md)) |
| `standup_reports.status` | Stateless engine resumes from `in_progress`; timed-out partials must not post ([ADR](../03_decisions/2026-06-14-stateless-dm-state.md)) |
| `app_users` table | DB-backed role tiers; first-login bootstrap; fresh-per-request role evaluation ([ADR](../03_decisions/2026-06-26-rbac-role-tiers.md)) |
| `team_managers` table | Many-to-many manager ownership scope; two-step assignment ([ADR](../03_decisions/2026-06-26-rbac-role-tiers.md)) |

## Notes

- `questions` and `answers` are JSONB; `answers` is the **single source of conversation
  state** — there is no separate per-message state store (see stateless DM ADR).
- `schedule_cron` is interpreted in each member's `timezone`; `standups.schedule_tz` is the
  fallback when a member has no captured TZ.
- Tokens are encrypted in the app layer before insertion; Supabase being managed does not
  change this stance.
