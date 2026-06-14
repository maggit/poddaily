# Scheduler Flow

Per-user-timezone fan-out for one standup run. Context:
[scheduler](../02_architecture/scheduler.md).

```mermaid
sequenceDiagram
  participant Cron as BullMQ repeatable job<br/>(per active standup)
  participant API as apps/api (internal)
  participant DB as Supabase Postgres
  participant Q as BullMQ queue
  participant DM as send-standup-dm worker
  participant Slack

  Cron->>API: POST /internal/runs/start/:standupId
  API->>DB: create standup_run (running)
  API->>DB: load members (can_report)
  loop each member
    API->>API: resolve member TZ → local send instant
    alt instant is now/past
      API->>Q: enqueue send-standup-dm (immediate)
    else later today
      API->>Q: enqueue send-standup-dm (delayed)
    end
  end
  Q->>DM: send-standup-dm (per member)
  DM->>Slack: open DM, post intro + Q1
  DM->>DB: insert standup_reports (in_progress)
  Note over DM,Slack: retries 3× exp backoff on failure

  Note over API,DB: complete-run finalizes; timeout sweeper<br/>marks in_progress > 4h as timed_out
```
