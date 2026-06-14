# Architecture Diagram

poddaily Phase 1 runtime topology. Context:
[system overview](../02_architecture/system-overview.md).

```mermaid
graph TD
  subgraph Dokploy["Dokploy (ROSA/EKS)"]
    Web["apps/web<br/>Next.js 15 + NextAuth<br/>:3000"]
    API["apps/api<br/>Hono REST + Slack<br/>:3001"]
    Worker["apps/worker<br/>BullMQ scheduler + jobs"]
    Redis[("Redis 7<br/>BullMQ queue<br/>self-hosted")]
  end

  Supabase[("Supabase<br/>Postgres 16<br/>managed")]
  Slack["Slack API<br/>Bot + Events + OAuth"]

  Web -->|REST| API
  API -->|Drizzle: DATABASE_URL pooled| Supabase
  Worker -->|Drizzle: DATABASE_URL pooled| Supabase
  Worker -->|enqueue / repeatable jobs| Redis
  API -->|enqueue| Redis
  Worker -->|internal bearer endpoints| API
  API -->|Bolt: events, OAuth, post-as-user| Slack
  Worker -->|send DM via bot token| Slack
  Web -->|admin Slack OIDC| Slack

  migrations["drizzle-kit migrations<br/>DIRECT_URL (session mode)"] -.-> Supabase
```

Notes:
- Postgres is **external** (Supabase) — not a container.
- Runtime queries use the pooled `DATABASE_URL`; migrations use the direct `DIRECT_URL`.
- `web`, `api`, `worker`, `redis` are the only deployed containers.
