# Phase 1 — Step 1: Foundation Implementation Plan

> **✅ STATUS: DONE** — executed via subagent-driven development and merged to `main`
> (merge commit `c540192`, 2026-06-15). All 8 tasks complete; `pnpm test` (4) and
> `pnpm smoke:db` green. See [build log](../08_logs/2026-06-14-foundation-build.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the poddaily monorepo with a typed database layer, a tested shared-logic package, local infrastructure, and a runnable `smoke:db` end-to-end check — the foundation every later vertical-slice step builds on.

**Architecture:** pnpm-workspace monorepo. `packages/db` owns the Drizzle schema + migrations (single source of truth for the database). `packages/shared` owns pure, unit-tested logic reused by api and worker. Local Postgres comes from the Supabase CLI; Redis from a container. A seed script puts the DB in a known state, and `smoke:db` proves migrations + seed + connectivity work end-to-end.

**Tech Stack:** Node 22, pnpm workspaces, TypeScript, Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver, Vitest, Supabase CLI, Docker (Redis).

Source spec: [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) · data model: [data-model.md](../02_architecture/data-model.md) · this is build-order step 1 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md).

---

## File Structure

```
poddaily/
├─ package.json                 # root: workspace scripts (test, db:migrate, seed, smoke:db)
├─ pnpm-workspace.yaml
├─ tsconfig.base.json           # shared TS config
├─ vitest.config.ts             # root test config (workspace-aware)
├─ docker-compose.yml           # redis only (Postgres is external/Supabase)
├─ .env.example                 # committed; .env.local is gitignored
├─ .gitignore
├─ supabase/config.toml         # from `supabase init`
├─ packages/
│  ├─ shared/
│  │  ├─ package.json
│  │  ├─ src/index.ts
│  │  ├─ src/dates.ts           # interpolateLastReportDate (pure)
│  │  ├─ src/questions.ts       # question types + defaults
│  │  └─ src/dates.test.ts
│  └─ db/
│     ├─ package.json
│     ├─ drizzle.config.ts
│     ├─ src/schema.ts          # all tables (data-model.md)
│     ├─ src/client.ts          # db connection factory
│     ├─ src/index.ts
│     ├─ src/schema.test.ts     # integration: schema exists
│     ├─ scripts/seed.ts        # known-state seed
│     ├─ scripts/smoke-db.ts    # smoke:db harness
│     └─ migrations/            # drizzle-kit output
```

Decomposition: `db` and `shared` are separate packages with one responsibility each. Schema, client, seed, and smoke live together in `db` because they change together. Pure date/question logic lives in `shared` so api/worker reuse it without importing the DB.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "poddaily",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "pnpm --filter @poddaily/db generate",
    "db:migrate": "pnpm --filter @poddaily/db migrate",
    "seed": "pnpm --filter @poddaily/db seed",
    "smoke:db": "pnpm --filter @poddaily/db smoke"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
.env.*.local
supabase/.branches/
supabase/.temp/
*.log
```

- [ ] **Step 5: Create `.env.example`**

```
# Database (Supabase). Locally, both point at the Supabase CLI Postgres.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
# Redis (BullMQ)
REDIS_URL=redis://127.0.0.1:6379
# Slack (stub values are fine for local; see ContextDB/00_index/getting-started.md)
SLACK_API_BASE_URL=http://127.0.0.1:4010
SLACK_BOT_TOKEN=xoxb-stub
SLACK_SIGNING_SECRET=stub-signing-secret
SLACK_CLIENT_ID=stub
SLACK_CLIENT_SECRET=stub
# Auth + internal
NEXTAUTH_SECRET=dev-secret
NEXTAUTH_URL=http://localhost:3000
INTERNAL_API_SECRET=dev-internal-secret
```

- [ ] **Step 6: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: `packages/shared` — date interpolation (TDD)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/dates.ts`, `packages/shared/src/questions.ts`
- Test: `packages/shared/src/dates.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@poddaily/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

- [ ] **Step 2: Write the failing test** — `packages/shared/src/dates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { interpolateLastReportDate } from "./dates";

describe("interpolateLastReportDate", () => {
  it("replaces {last_report_date} with a formatted date", () => {
    const out = interpolateLastReportDate(
      "What have you done since {last_report_date}?",
      new Date("2026-06-12T10:00:00Z"),
    );
    expect(out).toBe("What have you done since Friday, Jun 12?");
  });

  it("falls back to 'your last report' when no date is given", () => {
    const out = interpolateLastReportDate(
      "What have you done since {last_report_date}?",
      null,
    );
    expect(out).toBe("What have you done since your last report?");
  });

  it("leaves text without the token unchanged", () => {
    expect(interpolateLastReportDate("What will you do today?", null)).toBe(
      "What will you do today?",
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/dates.test.ts`
Expected: FAIL — cannot find module `./dates` / `interpolateLastReportDate` is not a function.

- [ ] **Step 4: Write minimal implementation** — `packages/shared/src/dates.ts`

```ts
const TOKEN = "{last_report_date}";

/** Format as "Friday, Jun 12" in UTC (deterministic for tests + scheduling). */
export function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function interpolateLastReportDate(
  text: string,
  lastReportDate: Date | null,
): string {
  if (!text.includes(TOKEN)) return text;
  const replacement = lastReportDate
    ? formatReportDate(lastReportDate)
    : "your last report";
  return text.split(TOKEN).join(replacement);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/src/dates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Create `packages/shared/src/questions.ts`** (types + defaults used by later steps)

```ts
export type QuestionType = "text";

export interface Question {
  id: string;
  text: string;
  hint?: string;
  type: QuestionType;
}

export const DEFAULT_QUESTIONS: Question[] = [
  { id: "q1", text: "What have you done since {last_report_date}?", type: "text" },
  { id: "q2", text: "What will you do today?", type: "text" },
  { id: "q3", text: "Anything blocking your progress?", type: "text" },
  { id: "q4", text: "How do you feel today?", type: "text" },
];
```

- [ ] **Step 7: Create `packages/shared/src/index.ts`**

```ts
export * from "./dates";
export * from "./questions";
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add date interpolation + question types"
```

---

### Task 3: `packages/db` — Drizzle schema

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@poddaily/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "seed": "tsx scripts/seed.ts",
    "smoke": "tsx scripts/smoke-db.ts"
  },
  "dependencies": {
    "@poddaily/shared": "workspace:*",
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/src/schema.ts`** (mirrors [data-model.md](../02_architecture/data-model.md))

```ts
import {
  pgTable, uuid, text, boolean, timestamp, jsonb, unique,
} from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slackChannelId: text("slack_channel_id").notNull().unique(),
  slackChannelName: text("slack_channel_name").notNull(),
  tribe: text("tribe"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull(),
  slackDisplayName: text("slack_display_name").notNull(),
  slackAvatarUrl: text("slack_avatar_url"),
  timezone: text("timezone"),
  canReport: boolean("can_report").default(true),
  canView: boolean("can_view").default(true),
  canEdit: boolean("can_edit").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqMember: unique().on(t.teamId, t.slackUserId) }));

export const standups = pgTable("standups", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }).unique(),
  name: text("name").notNull().default("Daily Standup"),
  questions: jsonb("questions").notNull(),
  scheduleCron: text("schedule_cron").notNull(),
  scheduleTz: text("schedule_tz").notNull().default("America/Mexico_City"),
  introMessage: text("intro_message"),
  outroMessage: text("outro_message"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const standupRuns = pgTable("standup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  standupId: uuid("standup_id").references(() => standups.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const standupReports = pgTable("standup_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => standupRuns.id),
  slackUserId: text("slack_user_id").notNull(),
  slackDisplayName: text("slack_display_name").notNull(),
  answers: jsonb("answers").notNull(),
  status: text("status").default("in_progress"),
  dmThreadTs: text("dm_thread_ts"),
  channelPostTs: text("channel_post_ts"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const slackUserTokens = pgTable("slack_user_tokens", {
  slackUserId: text("slack_user_id").primaryKey(),
  accessToken: text("access_token").notNull(),
  scopes: text("scopes").notNull(),
  authedAt: timestamp("authed_at", { withTimezone: true }).defaultNow(),
});

export const standupReminders = pgTable("standup_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => standupRuns.id),
  slackUserId: text("slack_user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
  type: text("type").default("initial"),
});
```

- [ ] **Step 3: Create `packages/db/src/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const sql = postgres(connectionString, { max: 10 });
  return { db: drizzle(sql, { schema }), sql };
}
```

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```ts
export * as schema from "./schema";
export { createDb } from "./client";
```

- [ ] **Step 5: Create `packages/db/drizzle.config.ts`** (uses DIRECT_URL for migrations)

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
```

- [ ] **Step 6: Install new deps**

Run: `pnpm install`
Expected: `drizzle-orm`, `postgres`, `drizzle-kit` resolved under `packages/db`.

- [ ] **Step 7: Generate the first migration**

Run: `pnpm db:generate`
Expected: a new SQL file appears under `packages/db/migrations/` creating all seven tables.

- [ ] **Step 8: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): add Drizzle schema, client, and initial migration"
```

---

### Task 4: Database integration test (schema applies)

**Files:**
- Create: `vitest.config.ts`
- Test: `packages/db/src/schema.test.ts`

> Requires local infra. If not already running: `supabase start`.

- [ ] **Step 1: Create root `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" },
    testTimeout: 20000,
  },
});
```

- [ ] **Step 2: Write the failing test** — `packages/db/src/schema.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "./client";

const { db, sql } = createDb();

afterAll(async () => { await sql.end(); });

describe("schema", () => {
  it("has all expected tables after migration", async () => {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
    `;
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "teams", "team_members", "standups", "standup_runs",
      "standup_reports", "slack_user_tokens", "standup_reminders",
    ]) {
      expect(names).toContain(t);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm db:migrate` was NOT yet run against a fresh DB, so first run on an empty DB:
`pnpm vitest run packages/db/src/schema.test.ts`
Expected: FAIL — tables missing (assertion fails on `teams`).

- [ ] **Step 4: Apply migrations**

Run: `pnpm db:migrate`
Expected: drizzle-kit applies the migration; "migrations applied" output.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/db/src/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts packages/db/src/schema.test.ts
git commit -m "test(db): verify schema applies to local Postgres"
```

---

### Task 5: Seed script (known state)

**Files:**
- Create: `packages/db/scripts/seed.ts`

- [ ] **Step 1: Write `packages/db/scripts/seed.ts`**

```ts
import { createDb, schema } from "../src/index";
import { DEFAULT_QUESTIONS } from "@poddaily/shared";

async function main() {
  const { db, sql } = createDb();

  const [team] = await db.insert(schema.teams).values({
    name: "Platform Pod",
    slackChannelId: "C_SEED_0001",
    slackChannelName: "platform-pod",
    tribe: "Infra",
  }).returning();

  await db.insert(schema.teamMembers).values({
    teamId: team.id,
    slackUserId: "U_SEED_0001",
    slackDisplayName: "Seed Reporter",
    timezone: "America/Mexico_City",
    canReport: true,
  });

  await db.insert(schema.standups).values({
    teamId: team.id,
    questions: DEFAULT_QUESTIONS,
    scheduleCron: "0 10 * * 1-5",
    scheduleTz: "America/Mexico_City",
    introMessage: "Hi! Time for Daily Standup.",
    outroMessage: "Thanks for your update!",
  });

  console.log(`Seeded team ${team.id} (Platform Pod) with 1 member + standup`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the seed (idempotency note: run against a fresh/migrated DB)**

Run: `pnpm db:migrate && pnpm seed`
Expected: prints `Seeded team <uuid> (Platform Pod) ...`.

- [ ] **Step 3: Verify rows exist**

Run: `psql "$DATABASE_URL" -c "select name from teams; select slack_display_name from team_members;"`
Expected: `Platform Pod` and `Seed Reporter` returned.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/seed.ts
git commit -m "feat(db): add known-state seed script"
```

---

### Task 6: Local infrastructure (Redis + Supabase init)

**Files:**
- Create: `docker-compose.yml`, `supabase/config.toml` (via CLI)

- [ ] **Step 1: Create `docker-compose.yml`** (Redis only; Postgres is external/Supabase)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redisdata:/data]
volumes:
  redisdata:
```

- [ ] **Step 2: Initialize Supabase local config**

Run: `supabase init`
Expected: creates `supabase/config.toml`. (If it prompts to overwrite, keep existing.)

- [ ] **Step 3: Bring infra up**

Run: `supabase start && docker compose up -d redis`
Expected: Supabase prints local API/DB URLs (DB on `:54322`); Redis container running.

- [ ] **Step 4: Verify Redis reachable**

Run: `docker compose exec redis redis-cli ping`
Expected: `PONG`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml supabase/config.toml
git commit -m "chore: local infra — redis compose + supabase init"
```

---

### Task 7: `smoke:db` end-to-end check

**Files:**
- Create: `packages/db/scripts/smoke-db.ts`

This is build-step 1's smoke scenario from [testing-and-local-dev.md](../02_architecture/testing-and-local-dev.md#per-phase-smoke-scenarios-phase-1-core): migrations applied, seed populated, connectivity OK.

- [ ] **Step 1: Write `packages/db/scripts/smoke-db.ts`**

```ts
import { createDb } from "../src/index";

const REQUIRED_TABLES = [
  "teams", "team_members", "standups", "standup_runs",
  "standup_reports", "slack_user_tokens", "standup_reminders",
];

async function main() {
  const { sql } = createDb();
  let ok = true;

  const tableRows = await sql`
    select table_name from information_schema.tables where table_schema = 'public'
  `;
  const names = tableRows.map((r) => r.table_name);
  for (const t of REQUIRED_TABLES) {
    if (!names.includes(t)) { console.error(`✗ missing table: ${t}`); ok = false; }
  }

  const [{ count: teamCount }] = await sql`select count(*)::int as count from teams`;
  const [{ count: memberCount }] = await sql`select count(*)::int as count from team_members`;
  const [{ count: standupCount }] = await sql`select count(*)::int as count from standups`;
  if (teamCount < 1 || memberCount < 1 || standupCount < 1) {
    console.error(`✗ seed incomplete: teams=${teamCount} members=${memberCount} standups=${standupCount}`);
    ok = false;
  }

  await sql.end();
  if (!ok) { console.error("smoke:db FAILED"); process.exit(1); }
  console.log("✓ smoke:db PASSED — schema + seed + connectivity OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the smoke against a migrated + seeded DB**

Run: `pnpm db:migrate && pnpm seed && pnpm smoke:db`
Expected: `✓ smoke:db PASSED — schema + seed + connectivity OK` (exit 0).

- [ ] **Step 3: Verify it fails loudly on an un-migrated DB**

Run: in a scratch DB with no migrations, `DATABASE_URL=<empty-db> pnpm smoke:db`
Expected: prints `✗ missing table: teams` and exits non-zero.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/smoke-db.ts
git commit -m "test(db): add smoke:db foundation end-to-end check"
```

---

### Task 8: Definition-of-done updates (docs/context)

Foundation establishes infra rather than a user-facing feature, but the per-phase
[Definition of Done](../02_architecture/testing-and-local-dev.md#definition-of-done-per-phase)
still applies: keep docs current.

**Files:**
- Modify: `README.md` (Quick start commands now real), `ContextDB/08_logs/` (new build log)

- [ ] **Step 1: Verify README Quick start matches reality**

Confirm the commands in [`README.md`](../../README.md) Quick start run as written
(`pnpm install` → `supabase start` → `docker compose up -d redis` → `pnpm db:migrate && pnpm seed` → `pnpm dev` is not yet valid because no apps exist; update the README note to say `pnpm dev` arrives in step 2). Edit that one line.

- [ ] **Step 2: Append a build log** — `ContextDB/08_logs/2026-06-14-foundation-build.md`

```markdown
# 2026-06-14 — Foundation Build (Phase 1, Step 1)

Scaffolded the pnpm monorepo; added `packages/shared` (date interpolation + question
types, unit-tested) and `packages/db` (Drizzle schema for all 7 tables, client, first
migration, seed, and `smoke:db`). Local infra: Redis compose + Supabase CLI.

- `pnpm test` green (shared unit tests + db schema test).
- `pnpm smoke:db` green against migrated + seeded local Postgres.

Next: build-order step 2 — Slack app manifest + bot install + admin NextAuth login
(`smoke:auth`).
```

- [ ] **Step 3: Commit**

```bash
git add README.md ContextDB/08_logs/2026-06-14-foundation-build.md
git commit -m "docs: foundation build log + README quick-start fixup"
```

---

## Verification (end of Step 1)

- [ ] `pnpm test` passes (shared + db).
- [ ] `pnpm db:migrate && pnpm seed && pnpm smoke:db` prints PASSED.
- [ ] `supabase start` + `docker compose up -d redis` bring up infra cleanly.
- [ ] Repo has `packages/shared` and `packages/db` with the structure above.

This produces working, testable software: a migrating, seedable database with a green
smoke check — the base for step 2 (Slack + auth).
