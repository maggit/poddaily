# Phase 2-D RBAC Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three role tiers (viewer / manager / admin) that gate who can edit teams and standups, replacing today's "any Slack-OAuth user is a full admin."

**Architecture:** Roles live in a new `app_users` table (source of truth), with per-team manager ownership in a `team_managers` join table. A `signIn` callback provisions users on login (first login while zero admins exist → admin; otherwise viewer). Role is read fresh from the DB per request via `lib/authz.ts` guards, which protect every server-action mutation. UI controls hide for users who can't edit, but the server-action guards are the real boundary.

**Tech Stack:** Next.js 15.5.19 (App Router, server actions), NextAuth 5.0.0-beta.31 (JWT), Drizzle ORM 0.33.0 + postgres-js, Postgres 16, Vitest 2.

## Global Constraints

- Drizzle operators (`eq`, `and`, `inArray`, `sql`, …) and `schema` MUST be imported from `@poddaily/db`, never directly from `drizzle-orm` (single shared instance — see `packages/db/src/index.ts`). Add any new operator to that re-export if missing.
- Web data-access lives in `apps/web/lib/*.ts` and imports the shared `db` from `apps/web/lib/db.ts`; tests import `sql` from the same module for cleanup and call `await sql.end()` in `afterAll`.
- DB-backed tests run against a real Postgres; `vitest.config.ts` defaults `DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (local Supabase). Every test that writes rows MUST clean them up.
- Role enum values are exactly `'viewer'`, `'manager'`, `'admin'` (in that order).
- `app_users` is keyed by Slack `user_id` (the session `user.id` / OIDC `sub`), consistent with `team_members` and `slack_user_tokens`.
- The `signIn` provisioning callback (DB access) MUST live in `apps/web/auth.ts` (Node runtime), NOT `apps/web/auth.config.ts` (shared with edge middleware). The `session` callback (no DB) may live in `auth.config.ts`.
- Migrations are generated with `pnpm --filter @poddaily/db generate` and applied with `pnpm --filter @poddaily/db migrate`. Never hand-edit the generated SQL except to confirm contents.

---

### Task 1: Roles persistence — schema, migration, and `lib/users.ts`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/schema.test.ts`
- Create: migration under `packages/db/migrations/` (via `generate`)
- Create: `apps/web/lib/users.ts`
- Test: `apps/web/lib/users.test.ts`

**Interfaces:**
- Produces (schema): `appUsers`, `teamManagers` tables; `userRole` pgEnum; types `AppUser`, `NewAppUser`, `UserRole`, `TeamManager`, `NewTeamManager`.
- Produces (`lib/users.ts`):
  - `getAppUser(slackUserId: string): Promise<AppUser | undefined>`
  - `listAppUsers(): Promise<AppUser[]>`
  - `countAdmins(): Promise<number>`
  - `provisionUserOnLogin(input: { slackUserId: string; email?: string; displayName?: string; avatarUrl?: string }): Promise<AppUser>`
  - `changeUserRole(slackUserId: string, role: UserRole): Promise<void>` (throws `LastAdminError`)
  - `class LastAdminError extends Error`
  - `listTeamManagers(teamId: string): Promise<AppUser[]>`
  - `isTeamManager(teamId: string, slackUserId: string): Promise<boolean>`
  - `addTeamManager(teamId: string, slackUserId: string): Promise<void>`
  - `removeTeamManager(teamId: string, slackUserId: string): Promise<void>`
  - `listManagerCandidates(): Promise<AppUser[]>` (role = `manager`)

- [ ] **Step 1: Add the enum + tables to the schema**

In `packages/db/src/schema.ts`, add `pgEnum` to the first import:

```typescript
import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, jsonb, unique, date, integer,
} from "drizzle-orm/pg-core";
```

Append after the `slackUserTokens` table (before the `export type` block):

```typescript
export const userRole = pgEnum("user_role", ["viewer", "manager", "admin"]);

export const appUsers = pgTable("app_users", {
  slackUserId: text("slack_user_id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const teamManagers = pgTable("team_managers", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  slackUserId: text("slack_user_id").notNull().references(() => appUsers.slackUserId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({ uniqTeamManager: unique().on(t.teamId, t.slackUserId) }));
```

Append to the `export type` block at the end of the file:

```typescript
export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];
export type TeamManager = typeof teamManagers.$inferSelect;
export type NewTeamManager = typeof teamManagers.$inferInsert;
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @poddaily/db generate`
Expected: a new file `packages/db/migrations/0005_*.sql` is created. Open it and confirm it contains (order may vary):

```sql
CREATE TYPE "public"."user_role" AS ENUM('viewer', 'manager', 'admin');
CREATE TABLE "app_users" ( ... "role" "user_role" DEFAULT 'viewer' NOT NULL, ... );
CREATE TABLE "team_managers" ( ... );
-- FK constraints from team_managers to teams and app_users, plus the unique(team_id, slack_user_id) index
```

If `generate` prompts about the enum, accept creating it. Do not hand-edit beyond confirming.

- [ ] **Step 3: Apply the migration locally**

Run: `pnpm --filter @poddaily/db migrate`
Expected: applies `0005_*` with no error (local Supabase must be running).

- [ ] **Step 4: Extend the schema existence test**

In `packages/db/src/schema.test.ts`, add `"app_users"` and `"team_managers"` to the table-name list asserted present:

```typescript
    for (const t of [
      "teams", "team_members", "standups", "standup_runs",
      "standup_reports", "slack_user_tokens", "standup_reminders",
      "app_users", "team_managers",
    ]) {
      expect(names).toContain(t);
    }
```

- [ ] **Step 5: Run the schema test (verify it passes)**

Run: `pnpm vitest run packages/db/src/schema.test.ts`
Expected: PASS (tables exist after migration).

- [ ] **Step 6: Write the failing `users.test.ts`**

Create `apps/web/lib/users.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import {
  getAppUser, listAppUsers, countAdmins, provisionUserOnLogin, changeUserRole,
  LastAdminError, listTeamManagers, isTeamManager, addTeamManager, removeTeamManager,
  listManagerCandidates,
} from "./users";
import { createTeam } from "./teams";
import { sql } from "./db";

const U1 = "U_RBAC_1", U2 = "U_RBAC_2", U3 = "U_RBAC_3";
const CHAN = "C_RBAC_USERS";

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${U1}, ${U2}, ${U3})`;
  await sql`delete from app_users where slack_user_id in (${U1}, ${U2}, ${U3})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("app_users data access", () => {
  it("provisions the first user as admin only while no admin exists", async () => {
    // Pretend the table already has an admin so bootstrap does NOT fire here.
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One", email: "one@x.io" });
    // U1 is the first user in a fresh wipe with zero admins -> admin
    expect((await getAppUser(U1))?.role).toBe("admin");
    // A second new user becomes a viewer (an admin now exists)
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    expect((await getAppUser(U2))?.role).toBe("viewer");
  });

  it("re-provisioning an existing user refreshes profile but keeps role", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" });        // admin (bootstrap)
    await changeUserRole(U1, "viewer");                                          // demote manually
    // promote a second admin so U1 is not the last admin
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    await changeUserRole(U2, "admin");
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One Renamed", email: "new@x.io" });
    const u = await getAppUser(U1);
    expect(u?.role).toBe("viewer");           // unchanged by re-login
    expect(u?.displayName).toBe("One Renamed");
    expect(u?.email).toBe("new@x.io");
  });

  it("refuses to demote the last admin", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" }); // sole admin
    expect(await countAdmins()).toBe(1);
    await expect(changeUserRole(U1, "viewer")).rejects.toBeInstanceOf(LastAdminError);
    // With a second admin present, demotion is allowed.
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    await changeUserRole(U2, "admin");
    await changeUserRole(U1, "manager");
    expect((await getAppUser(U1))?.role).toBe("manager");
  });

  it("lists manager candidates and manages team-manager links", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "Admin" }); // admin
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Mgr" });
    await changeUserRole(U2, "manager");
    expect((await listManagerCandidates()).map((u) => u.slackUserId)).toContain(U2);

    const team = await createTeam({ name: "RBAC Pod", slackChannelId: CHAN, slackChannelName: "rbac" });
    expect(await isTeamManager(team.id, U2)).toBe(false);
    await addTeamManager(team.id, U2);
    await addTeamManager(team.id, U2); // idempotent
    expect(await isTeamManager(team.id, U2)).toBe(true);
    expect((await listTeamManagers(team.id)).map((u) => u.slackUserId)).toEqual([U2]);
    await removeTeamManager(team.id, U2);
    expect(await isTeamManager(team.id, U2)).toBe(false);
  });

  it("listAppUsers returns provisioned users", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" });
    const ids = (await listAppUsers()).map((u) => u.slackUserId);
    expect(ids).toContain(U1);
  });
});
```

- [ ] **Step 7: Run the test (verify it fails)**

Run: `pnpm vitest run apps/web/lib/users.test.ts`
Expected: FAIL — `./users` has no such exports.

- [ ] **Step 8: Implement `lib/users.ts`**

Create `apps/web/lib/users.ts`:

```typescript
import { eq, and, inArray, sql as dsql, schema } from "@poddaily/db";
import type { AppUser, UserRole } from "@poddaily/db/schema";
import { db } from "./db";

export class LastAdminError extends Error {
  constructor(message = "Cannot remove the last admin") {
    super(message);
    this.name = "LastAdminError";
  }
}

export async function getAppUser(slackUserId: string): Promise<AppUser | undefined> {
  const [u] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.slackUserId, slackUserId));
  return u;
}

export function listAppUsers(): Promise<AppUser[]> {
  return db.select().from(schema.appUsers).orderBy(schema.appUsers.displayName);
}

export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.role, "admin"));
  return row?.n ?? 0;
}

/**
 * Upsert the user's profile on login. The first user provisioned while zero admins
 * exist becomes an admin; every other new user defaults to viewer. Existing users
 * keep their role and only have profile + last_login_at refreshed.
 */
export async function provisionUserOnLogin(input: {
  slackUserId: string; email?: string; displayName?: string; avatarUrl?: string;
}): Promise<AppUser> {
  const existing = await getAppUser(input.slackUserId);
  await db
    .insert(schema.appUsers)
    .values({
      slackUserId: input.slackUserId,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      lastLoginAt: dsql`now()`,
    })
    .onConflictDoUpdate({
      target: schema.appUsers.slackUserId,
      set: {
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        lastLoginAt: dsql`now()`,
      },
    });
  if (!existing && (await countAdmins()) === 0) {
    await db.update(schema.appUsers).set({ role: "admin" }).where(eq(schema.appUsers.slackUserId, input.slackUserId));
  }
  return (await getAppUser(input.slackUserId))!;
}

export async function changeUserRole(slackUserId: string, role: UserRole): Promise<void> {
  const user = await getAppUser(slackUserId);
  if (user?.role === "admin" && role !== "admin" && (await countAdmins()) <= 1) {
    throw new LastAdminError();
  }
  await db.update(schema.appUsers).set({ role }).where(eq(schema.appUsers.slackUserId, slackUserId));
}

export function listManagerCandidates(): Promise<AppUser[]> {
  return db.select().from(schema.appUsers).where(eq(schema.appUsers.role, "manager")).orderBy(schema.appUsers.displayName);
}

export async function listTeamManagers(teamId: string): Promise<AppUser[]> {
  const rows = await db
    .select({ uid: schema.teamManagers.slackUserId })
    .from(schema.teamManagers)
    .where(eq(schema.teamManagers.teamId, teamId));
  const ids = rows.map((r) => r.uid);
  if (ids.length === 0) return [];
  return db.select().from(schema.appUsers).where(inArray(schema.appUsers.slackUserId, ids)).orderBy(schema.appUsers.displayName);
}

export async function isTeamManager(teamId: string, slackUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.teamManagers.id })
    .from(schema.teamManagers)
    .where(and(eq(schema.teamManagers.teamId, teamId), eq(schema.teamManagers.slackUserId, slackUserId)))
    .limit(1);
  return !!row;
}

export async function addTeamManager(teamId: string, slackUserId: string): Promise<void> {
  await db.insert(schema.teamManagers).values({ teamId, slackUserId }).onConflictDoNothing();
}

export async function removeTeamManager(teamId: string, slackUserId: string): Promise<void> {
  await db
    .delete(schema.teamManagers)
    .where(and(eq(schema.teamManagers.teamId, teamId), eq(schema.teamManagers.slackUserId, slackUserId)));
}
```

- [ ] **Step 9: Run the test (verify it passes)**

Run: `pnpm vitest run apps/web/lib/users.test.ts`
Expected: PASS (all five cases green).

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/migrations apps/web/lib/users.ts apps/web/lib/users.test.ts
git commit -m "feat(rbac): app_users + team_managers schema and data access"
```

---

### Task 2: Authz layer — `session.user.id` + `lib/authz.ts`

**Files:**
- Modify: `apps/web/auth.config.ts` (add `session` callback)
- Create: `apps/web/types/next-auth.d.ts`
- Create: `apps/web/lib/authz.ts`
- Test: `apps/web/lib/authz.test.ts`

**Interfaces:**
- Consumes: `getAppUser`, `isTeamManager` from `./users`; `auth` from `@/auth`; `UserRole` from `@poddaily/db/schema`.
- Produces:
  - `interface CurrentUser { slackUserId: string; role: UserRole; name?: string; email?: string; image?: string }`
  - `class ForbiddenError extends Error`
  - `canEditTeamFor(role: UserRole, isManagerOfTeam: boolean): boolean` (pure)
  - `getCurrentUser(): Promise<CurrentUser | null>`
  - `requireUser(): Promise<CurrentUser>` (redirects to `/login`)
  - `requireAdmin(): Promise<CurrentUser>` (throws `ForbiddenError`)
  - `canEditTeam(user: CurrentUser | null, teamId: string): Promise<boolean>`
  - `assertCanEditTeam(user: CurrentUser | null, teamId: string): Promise<void>` (throws `ForbiddenError`)
  - `requireTeamEdit(teamId: string): Promise<CurrentUser>` (throws `ForbiddenError`)

- [ ] **Step 1: Surface `session.user.id` from the JWT**

In `apps/web/auth.config.ts`, extend the `callbacks` block (the JWT `sub` is the Slack user id set by `profile()`):

```typescript
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
```

- [ ] **Step 2: Augment the Session type**

Create `apps/web/types/next-auth.d.ts`:

```typescript
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export {};
```

- [ ] **Step 3: Write the failing `authz.test.ts`**

Create `apps/web/lib/authz.test.ts`. The pure matrix needs no DB; the async checks seed real rows.

```typescript
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { canEditTeamFor, canEditTeam, assertCanEditTeam, ForbiddenError, type CurrentUser } from "./authz";
import { provisionUserOnLogin, changeUserRole, addTeamManager } from "./users";
import { createTeam } from "./teams";
import { sql } from "./db";

const ADMIN = "U_AZ_ADMIN", MGR = "U_AZ_MGR", VIEWER = "U_AZ_VIEWER";
const CHAN = "C_AZ", CHAN2 = "C_AZ2";

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from app_users where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN}, ${CHAN2})`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

const user = (slackUserId: string, role: CurrentUser["role"]): CurrentUser => ({ slackUserId, role });

describe("canEditTeamFor (pure matrix)", () => {
  it("admin edits any team; manager only owned; viewer never", () => {
    expect(canEditTeamFor("admin", false)).toBe(true);
    expect(canEditTeamFor("admin", true)).toBe(true);
    expect(canEditTeamFor("manager", true)).toBe(true);
    expect(canEditTeamFor("manager", false)).toBe(false);
    expect(canEditTeamFor("viewer", true)).toBe(false);
    expect(canEditTeamFor("viewer", false)).toBe(false);
  });
});

describe("canEditTeam / assertCanEditTeam (against DB)", () => {
  it("scopes managers to their owned teams", async () => {
    await provisionUserOnLogin({ slackUserId: ADMIN, displayName: "Admin" }); // bootstrap admin
    await provisionUserOnLogin({ slackUserId: MGR, displayName: "Mgr" });
    await changeUserRole(MGR, "manager");
    await provisionUserOnLogin({ slackUserId: VIEWER, displayName: "Viewer" }); // viewer by default

    const owned = await createTeam({ name: "Owned", slackChannelId: CHAN, slackChannelName: "owned" });
    const other = await createTeam({ name: "Other", slackChannelId: CHAN2, slackChannelName: "other" });
    await addTeamManager(owned.id, MGR);

    expect(await canEditTeam(user(ADMIN, "admin"), other.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), owned.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), other.id)).toBe(false);
    expect(await canEditTeam(user(VIEWER, "viewer"), owned.id)).toBe(false);
    expect(await canEditTeam(null, owned.id)).toBe(false);

    await expect(assertCanEditTeam(user(MGR, "manager"), other.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertCanEditTeam(user(MGR, "manager"), owned.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test (verify it fails)**

Run: `pnpm vitest run apps/web/lib/authz.test.ts`
Expected: FAIL — `./authz` does not exist.

- [ ] **Step 5: Implement `lib/authz.ts`**

Create `apps/web/lib/authz.ts`:

```typescript
import { redirect } from "next/navigation";
import type { UserRole } from "@poddaily/db/schema";
import { auth } from "@/auth";
import { getAppUser, isTeamManager } from "./users";

export interface CurrentUser {
  slackUserId: string;
  role: UserRole;
  name?: string;
  email?: string;
  image?: string;
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Pure permission decision — admin edits anything, manager edits owned teams, viewer never. */
export function canEditTeamFor(role: UserRole, isManagerOfTeam: boolean): boolean {
  return role === "admin" || (role === "manager" && isManagerOfTeam);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const appUser = await getAppUser(id);
  return {
    slackUserId: id,
    role: appUser?.role ?? "viewer",
    name: session.user?.name ?? undefined,
    email: session.user?.email ?? undefined,
    image: session.user?.image ?? undefined,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new ForbiddenError();
  return u;
}

export async function canEditTeam(user: CurrentUser | null, teamId: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role !== "manager") return false;
  return isTeamManager(teamId, user.slackUserId);
}

export async function assertCanEditTeam(user: CurrentUser | null, teamId: string): Promise<void> {
  if (!(await canEditTeam(user, teamId))) throw new ForbiddenError();
}

export async function requireTeamEdit(teamId: string): Promise<CurrentUser> {
  const u = await requireUser();
  await assertCanEditTeam(u, teamId);
  return u;
}
```

- [ ] **Step 6: Run the test (verify it passes)**

Run: `pnpm vitest run apps/web/lib/authz.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck the web app**

Run: `pnpm --filter @poddaily/web typecheck`
Expected: no errors (the `session.user.id` augmentation resolves).

- [ ] **Step 8: Commit**

```bash
git add apps/web/auth.config.ts apps/web/types/next-auth.d.ts apps/web/lib/authz.ts apps/web/lib/authz.test.ts
git commit -m "feat(rbac): session user id + authz guards"
```

---

### Task 3: Provision users on login

**Files:**
- Create: `apps/web/lib/auth-callbacks.ts`
- Modify: `apps/web/auth.ts`
- Test: `apps/web/lib/auth-callbacks.test.ts`

**Interfaces:**
- Consumes: `provisionUserOnLogin` from `./users`.
- Produces: `onSignIn(params: { user: { id?: string | null; name?: string | null; email?: string | null; image?: string | null } }): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/auth-callbacks.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { onSignIn } from "./auth-callbacks";
import { getAppUser } from "./users";
import { sql } from "./db";

const A = "U_SIGNIN_A", B = "U_SIGNIN_B";
async function wipe() {
  await sql`delete from app_users where slack_user_id in (${A}, ${B})`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("onSignIn provisioning", () => {
  it("provisions the first user as admin and refuses login without an id", async () => {
    expect(await onSignIn({ user: { id: A, name: "Ada", email: "ada@x.io", image: "http://x/a.png" } })).toBe(true);
    const u = await getAppUser(A);
    expect(u?.role).toBe("admin");
    expect(u?.displayName).toBe("Ada");
    // Second user becomes viewer; still allowed in.
    expect(await onSignIn({ user: { id: B, name: "Bo" } })).toBe(true);
    expect((await getAppUser(B))?.role).toBe("viewer");
    // No id -> reject.
    expect(await onSignIn({ user: { id: null } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (verify it fails)**

Run: `pnpm vitest run apps/web/lib/auth-callbacks.test.ts`
Expected: FAIL — `./auth-callbacks` does not exist.

- [ ] **Step 3: Implement `lib/auth-callbacks.ts`**

Create `apps/web/lib/auth-callbacks.ts`:

```typescript
import { provisionUserOnLogin } from "./users";

/**
 * NextAuth `signIn` callback. Provisions/refreshes the app_users row on every login
 * (first user while zero admins exist becomes admin; others become viewers). Lives in
 * the Node runtime via auth.ts — never imported into the edge auth.config.ts.
 */
export async function onSignIn(params: {
  user: { id?: string | null; name?: string | null; email?: string | null; image?: string | null };
}): Promise<boolean> {
  const id = params.user?.id;
  if (!id) return false;
  await provisionUserOnLogin({
    slackUserId: id,
    email: params.user.email ?? undefined,
    displayName: params.user.name ?? undefined,
    avatarUrl: params.user.image ?? undefined,
  });
  return true;
}
```

- [ ] **Step 4: Wire it into `auth.ts`**

Replace `apps/web/auth.ts` with:

```typescript
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { onSignIn } from "./lib/auth-callbacks";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    signIn: onSignIn,
  },
});
```

- [ ] **Step 5: Run the test (verify it passes)**

Run: `pnpm vitest run apps/web/lib/auth-callbacks.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @poddaily/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/auth-callbacks.ts apps/web/lib/auth-callbacks.test.ts apps/web/auth.ts
git commit -m "feat(rbac): provision app_users on Slack login"
```

---

### Task 4: Guard the existing server actions + gate edit UI

> The server-action guards are the real authorization boundary. UI gating is cosmetic. This repo does not unit-test server-component pages (logic lives in tested `lib/*`); verification here is the guard behavior already covered by Task 2's tests plus typecheck/lint. The end-to-end matrix is exercised by the RBAC smoke in Task 7.

**Files:**
- Modify: `apps/web/app/(dashboard)/teams/new/page.tsx`
- Modify: `apps/web/app/(dashboard)/teams/[id]/page.tsx`
- Modify: `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`
- Modify: `apps/web/components/teams/member-table.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `requireTeamEdit`, `getCurrentUser`, `canEditTeam` from `@/lib/authz`.

- [ ] **Step 1: Guard team creation (admin-only)**

In `apps/web/app/(dashboard)/teams/new/page.tsx`, add the import and guard at the top of `createTeamAction`:

```typescript
import { requireAdmin } from "@/lib/authz";
```

```typescript
async function createTeamAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
```

- [ ] **Step 2: Guard the member server actions + gate UI on the team detail page**

In `apps/web/app/(dashboard)/teams/[id]/page.tsx`:

Add the import:

```typescript
import { requireTeamEdit, getCurrentUser, canEditTeam } from "@/lib/authz";
```

Add `await requireTeamEdit(id);` as the first line after `"use server";` in `addMemberAction`, `setPermAction`, and `removeAction`. Example for `addMemberAction`:

```typescript
  async function addMemberAction(fd: FormData) {
    "use server";
    await requireTeamEdit(id);
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
```

Then compute editability before the `return` and gate the controls. Replace the `return (...)` block's members section:

```typescript
  const me = await getCurrentUser();
  const editable = await canEditTeam(me, id);

  return (
    <div className="space-y-6">
      <PageHeader title={team.name} />
      <div className="text-sm text-muted-foreground">#{team.slackChannelName}{team.tribe ? ` · ${team.tribe}` : ""}</div>
      <div className="flex gap-4">
        <Link href={`/teams/${id}/standup`} className="text-[13px] font-medium text-accent hover:underline">Configure standup →</Link>
        <Link href={`/reports/${id}`} className="text-[13px] font-medium text-accent hover:underline">View reports →</Link>
      </div>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Members</h2>
        <MemberTable members={members} connectedUserIds={connectedUserIds} editable={editable} setPermAction={setPermAction} removeAction={removeAction} />
        {editable ? <AddMemberForm action={addMemberAction} /> : null}
      </section>
    </div>
  );
```

- [ ] **Step 3: Make `MemberTable` honor `editable`**

In `apps/web/components/teams/member-table.tsx`, add `editable` to the props and render read-only cells when it is false. Replace the component signature and the two interactive cells:

```typescript
export function MemberTable({
  members, connectedUserIds, editable = true, setPermAction, removeAction,
}: {
  members: TeamMember[];
  connectedUserIds: string[];
  editable?: boolean;
  setPermAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
```

Replace the permission cell (the `.map((perm) => ...)` block) with:

```typescript
          {(["canView", "canReport", "canEdit"] as const).map((perm) => (
            <Td key={perm} className="text-center">
              {editable ? (
                <form action={setPermAction} className="inline">
                  <input type="hidden" name="memberId" value={m.id} />
                  <input type="hidden" name="canView" value={String(perm === "canView" ? !m.canView : m.canView)} />
                  <input type="hidden" name="canReport" value={String(perm === "canReport" ? !m.canReport : m.canReport)} />
                  <input type="hidden" name="canEdit" value={String(perm === "canEdit" ? !m.canEdit : m.canEdit)} />
                  <button type="submit" aria-label={`toggle ${perm}`} className={`h-4 w-4 rounded border ${m[perm] ? "border-accent bg-accent" : "border-input bg-background"}`} />
                </form>
              ) : (
                <span aria-label={perm} className={`inline-block h-4 w-4 rounded border ${m[perm] ? "border-accent bg-accent" : "border-input bg-background"}`} />
              )}
            </Td>
          ))}
```

Replace the final remove cell (`<Td className="text-right">...`) with:

```typescript
          <Td className="text-right">
            {editable ? (
              <form action={removeAction} className="inline">
                <input type="hidden" name="memberId" value={m.id} />
                <button type="submit" className="text-danger hover:underline">Remove</button>
              </form>
            ) : null}
          </Td>
```

- [ ] **Step 4: Guard the standup server actions + gate the form**

In `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`:

Add the import:

```typescript
import { requireTeamEdit, getCurrentUser, canEditTeam } from "@/lib/authz";
```

Add `await requireTeamEdit(id);` as the first line after `"use server";` in both `saveAction` and `toggleActiveAction`. Then gate the editable form. Before `return (`, add:

```typescript
  const editable = await canEditTeam(await getCurrentUser(), id);
```

Wrap the pause/resume `<form>` and the `<StandupForm .../>` so they only render when `editable`; otherwise render a read-only notice. Replace the returned JSX body's interactive parts:

```typescript
  return (
    <div className="space-y-6">
      <PageHeader title={`${team.name} · Standup`} />
      {standup ? (
        <div className="flex items-center gap-3">
          <StatusPill tone={standup.isActive === false ? "neutral" : "success"}>
            {standup.isActive === false ? "Paused" : "Active"}
          </StatusPill>
          {editable ? (
            <form action={toggleActiveAction}>
              <button type="submit" className="text-[13px] font-medium text-accent hover:underline">
                {standup.isActive === false ? "Resume standup" : "Pause standup"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <StandupForm
          action={saveAction}
          questions={questions}
          weekdays={weekdays} hour={hour} minute={minute} tz={tz}
          introMessage={introMessage} outroMessage={outroMessage}
          reminderIntervalMinutes={reminderIntervalMinutes}
        />
      ) : (
        <p className="text-sm text-muted-foreground">You have read-only access to this standup.</p>
      )}
    </div>
  );
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @poddaily/web typecheck && pnpm --filter @poddaily/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/teams apps/web/components/teams/member-table.tsx
git commit -m "feat(rbac): guard team/standup mutations and gate edit UI"
```

---

### Task 5: People admin page + nav gating

**Files:**
- Create: `apps/web/app/(dashboard)/people/page.tsx`
- Create: `apps/web/components/people/role-select.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx`
- Modify: `apps/web/components/app-shell/sidebar.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `getCurrentUser` from `@/lib/authz`; `listAppUsers`, `changeUserRole`, `LastAdminError` from `@/lib/users`; `UserRole` from `@poddaily/db/schema`.

- [ ] **Step 1: Build the role-select client component**

Create `apps/web/components/people/role-select.tsx`:

```typescript
"use client";
import type { UserRole } from "@poddaily/db/schema";

const ROLES: UserRole[] = ["viewer", "manager", "admin"];

export function RoleSelect({
  slackUserId, role, action,
}: {
  slackUserId: string;
  role: UserRole;
  action: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="slackUserId" value={slackUserId} />
      <select
        name="role"
        defaultValue={role}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </form>
  );
}
```

- [ ] **Step 2: Build the People page (admin-only)**

Create `apps/web/app/(dashboard)/people/page.tsx`:

```typescript
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { listAppUsers, changeUserRole, LastAdminError } from "@/lib/users";
import type { UserRole } from "@poddaily/db/schema";
import { PageHeader } from "@/components/page-header";
import { DataTable, Th, Td } from "@/components/ui/data-table";
import { RoleSelect } from "@/components/people/role-select";

const ROLE_VALUES: UserRole[] = ["viewer", "manager", "admin"];

export default async function PeoplePage() {
  await requireAdmin();
  const users = await listAppUsers();

  async function setRoleAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const slackUserId = String(fd.get("slackUserId") ?? "");
    const role = String(fd.get("role") ?? "") as UserRole;
    if (!slackUserId || !ROLE_VALUES.includes(role)) throw new Error("Invalid role change");
    try {
      await changeUserRole(slackUserId, role);
    } catch (err) {
      if (err instanceof LastAdminError) throw new Error("Cannot remove the last admin");
      throw err;
    }
    revalidatePath("/people");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="People" />
      <p className="text-sm text-muted-foreground">
        Roles gate who can edit teams and standups. Viewers are read-only; managers edit the teams they own; admins can do everything and assign roles.
      </p>
      {users.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No users yet.</div>
      ) : (
        <DataTable head={<><Th>Name</Th><Th>Slack ID</Th><Th>Email</Th><Th>Role</Th></>}>
          {users.map((u) => (
            <tr key={u.slackUserId} className="hover:bg-surface-muted">
              <Td><span className="font-medium text-foreground">{u.displayName ?? "—"}</span></Td>
              <Td className="text-subtle-foreground">{u.slackUserId}</Td>
              <Td className="text-muted-foreground">{u.email ?? "—"}</Td>
              <Td><RoleSelect slackUserId={u.slackUserId} role={u.role} action={setRoleAction} /></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Pass `isAdmin` into the sidebar from the layout**

In `apps/web/app/(dashboard)/layout.tsx`, compute the current user's admin status and pass it down:

```typescript
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { getCurrentUser } from "@/lib/authz";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userName={me.name} isAdmin={me.role === "admin"} />
      <div className="flex flex-1 flex-col">
        <TopBar breadcrumb={<span>Home <span className="text-border">/</span> <span className="text-foreground">Teams</span></span>} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the People link only for admins**

In `apps/web/components/app-shell/sidebar.tsx`, add `Shield` to the icon imports and render an admin-only People link. Update the import line and component:

```typescript
import { Users, ListChecks, MessageSquare, Settings, Shield, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = { Users, ListChecks, MessageSquare, Settings, Shield };

export function Sidebar({ userName, isAdmin }: { userName?: string; isAdmin?: boolean }) {
```

Inside the `<nav>`, after the `{NAV_ITEMS.map(...)}` block, add:

```typescript
        {isAdmin ? (
          (() => {
            const active = pathname === "/people" || pathname.startsWith("/people");
            return (
              <Link href="/people"
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${active ? "bg-accent-subtle font-medium text-accent" : "text-muted-foreground hover:bg-muted"}`}>
                <Shield className="h-[17px] w-[17px]" />
                People
              </Link>
            );
          })()
        ) : null}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @poddaily/web typecheck && pnpm --filter @poddaily/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/people apps/web/components/people apps/web/app/\(dashboard\)/layout.tsx apps/web/components/app-shell/sidebar.tsx
git commit -m "feat(rbac): admin People page with role assignment"
```

---

### Task 6: Team-managers assignment UI (admin-only)

**Files:**
- Modify: `apps/web/app/(dashboard)/teams/[id]/page.tsx`
- Create: `apps/web/components/teams/managers-section.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `getCurrentUser` from `@/lib/authz`; `listTeamManagers`, `listManagerCandidates`, `addTeamManager`, `removeTeamManager` from `@/lib/users`.

- [ ] **Step 1: Build the managers section component**

Create `apps/web/components/teams/managers-section.tsx`:

```typescript
import type { AppUser } from "@poddaily/db/schema";

export function ManagersSection({
  managers, candidates, addAction, removeAction,
}: {
  managers: AppUser[];
  candidates: AppUser[];
  addAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
  const assignable = candidates.filter((c) => !managers.some((m) => m.slackUserId === c.slackUserId));
  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium">Managers</h2>
      <p className="text-xs text-subtle-foreground">Managers can edit this team's members and standup. Promote someone to the manager role on the People page first.</p>
      {managers.length === 0 ? (
        <div className="text-sm text-muted-foreground">No managers assigned.</div>
      ) : (
        <ul className="space-y-1">
          {managers.map((m) => (
            <li key={m.slackUserId} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-foreground">{m.displayName ?? m.slackUserId}</span>
              <span className="text-subtle-foreground">{m.slackUserId}</span>
              <form action={removeAction} className="inline">
                <input type="hidden" name="slackUserId" value={m.slackUserId} />
                <button type="submit" className="text-danger hover:underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {assignable.length > 0 ? (
        <form action={addAction} className="flex items-end gap-3">
          <label className="space-y-1.5">
            <span className="block text-[13px] font-medium">Assign manager</span>
            <select name="slackUserId" className="h-9 w-64 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
              {assignable.map((c) => <option key={c.slackUserId} value={c.slackUserId}>{(c.displayName ?? c.slackUserId)} ({c.slackUserId})</option>)}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Assign</button>
        </form>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Wire the managers section into the team detail page (admin-only)**

In `apps/web/app/(dashboard)/teams/[id]/page.tsx`, add imports:

```typescript
import { listTeamManagers, listManagerCandidates, addTeamManager, removeTeamManager } from "@/lib/users";
import { ManagersSection } from "@/components/teams/managers-section";
```

Add the two server actions alongside the existing ones (inside the page component):

```typescript
  async function assignManagerAction(fd: FormData) {
    "use server";
    await requireAdmin();
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    if (slackUserId) await addTeamManager(id, slackUserId);
    revalidatePath(`/teams/${id}`);
  }
  async function unassignManagerAction(fd: FormData) {
    "use server";
    await requireAdmin();
    await removeTeamManager(id, String(fd.get("slackUserId") ?? ""));
    revalidatePath(`/teams/${id}`);
  }
```

Add `requireAdmin` to the authz import in this file:

```typescript
import { requireTeamEdit, requireAdmin, getCurrentUser, canEditTeam } from "@/lib/authz";
```

Load the managers data near the top (after `editable` is computed) and render the section when the viewer is an admin. Add before `return`:

```typescript
  const managers = me?.role === "admin" ? await listTeamManagers(id) : [];
  const managerCandidates = me?.role === "admin" ? await listManagerCandidates() : [];
```

Insert the section into the returned JSX, after the Members `</section>`:

```typescript
      {me?.role === "admin" ? (
        <ManagersSection
          managers={managers}
          candidates={managerCandidates}
          addAction={assignManagerAction}
          removeAction={unassignManagerAction}
        />
      ) : null}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @poddaily/web typecheck && pnpm --filter @poddaily/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(dashboard\)/teams/\[id\]/page.tsx apps/web/components/teams/managers-section.tsx
git commit -m "feat(rbac): assign team managers from the team page"
```

---

### Task 7: RBAC smoke test + script

**Files:**
- Create: `apps/web/tests/rbac-smoke.test.ts`
- Modify: root `package.json` (add `smoke:rbac`; extend `smoke:phase2` if present, else add it)

**Interfaces:**
- Consumes: `provisionUserOnLogin`, `changeUserRole`, `addTeamManager` from `../lib/users`; `canEditTeam`, `canEditTeamFor` from `../lib/authz`; `createTeam` from `../lib/teams`.

- [ ] **Step 1: Inspect existing smoke scripts**

Run: `grep -n "smoke:" package.json`
Note whether a `smoke:phase2` aggregate exists. (As of writing, scripts are `smoke:db`, `smoke:auth`, `smoke:team`, `smoke:config`, `smoke:standup-outbound`, `smoke:standup`, `smoke:edges`, `smoke:retrigger`.) You will add `smoke:rbac`.

- [ ] **Step 2: Write the smoke test**

Create `apps/web/tests/rbac-smoke.test.ts`:

```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { provisionUserOnLogin, changeUserRole, addTeamManager } from "../lib/users";
import { canEditTeam, canEditTeamFor, type CurrentUser } from "../lib/authz";
import { createTeam } from "../lib/teams";
import { sql } from "../lib/db";

const ADMIN = "U_SMK_ADMIN", MGR = "U_SMK_MGR", VIEWER = "U_SMK_VIEWER";
const CHAN_A = "C_SMK_A", CHAN_B = "C_SMK_B";
const user = (slackUserId: string, role: CurrentUser["role"]): CurrentUser => ({ slackUserId, role });

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from app_users where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN_A}, ${CHAN_B})`;
}
beforeAll(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("smoke:rbac", () => {
  it("enforces the viewer/manager/admin matrix end to end", async () => {
    // Pure matrix sanity.
    expect(canEditTeamFor("manager", true)).toBe(true);
    expect(canEditTeamFor("manager", false)).toBe(false);

    // Bootstrap: first provisioned user (zero admins) becomes admin.
    await provisionUserOnLogin({ slackUserId: ADMIN, displayName: "Admin" });
    expect(canEditTeamFor("admin", false)).toBe(true);

    await provisionUserOnLogin({ slackUserId: MGR, displayName: "Mgr" });
    await changeUserRole(MGR, "manager");
    await provisionUserOnLogin({ slackUserId: VIEWER, displayName: "Viewer" }); // viewer

    const teamA = await createTeam({ name: "Pod A", slackChannelId: CHAN_A, slackChannelName: "pod-a" });
    const teamB = await createTeam({ name: "Pod B", slackChannelId: CHAN_B, slackChannelName: "pod-b" });
    await addTeamManager(teamA.id, MGR);

    expect(await canEditTeam(user(ADMIN, "admin"), teamB.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), teamA.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), teamB.id)).toBe(false);
    expect(await canEditTeam(user(VIEWER, "viewer"), teamA.id)).toBe(false);
  });
});
```

- [ ] **Step 3: Add the `smoke:rbac` script**

In root `package.json` scripts, add (mirroring the existing smoke entries):

```json
    "smoke:rbac": "vitest run apps/web/lib/users.test.ts apps/web/lib/authz.test.ts apps/web/lib/auth-callbacks.test.ts apps/web/tests/rbac-smoke.test.ts",
```

If a `smoke:phase2` aggregate script exists, append `&& pnpm smoke:rbac` to it; otherwise no aggregate change is needed.

- [ ] **Step 4: Run the smoke (verify it passes)**

Run: `pnpm smoke:rbac`
Expected: PASS across all four files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/rbac-smoke.test.ts package.json
git commit -m "test(rbac): smoke covering the viewer/manager/admin matrix"
```

---

### Task 8: Docs + Definition of Done

**Files:**
- Modify: `README.md`
- Modify: `ContextDB/todos/phase-2-backlog.md`
- Create: `ContextDB/03_decisions/2026-06-26-rbac-role-tiers.md`
- Modify: `ContextDB/02_architecture/data-model.md`

- [ ] **Step 1: Update the README**

In `README.md`: tick the RBAC item in the Phase 2 feature checklist (search for "RBAC"). Add a short "Roles & access" subsection documenting:
- The three tiers (viewer = read-only, manager = edit owned teams, admin = everything + assign roles).
- Bootstrap: the first person to log in on a fresh install (while no admin exists) becomes admin; everyone else is auto-provisioned as a viewer.
- How to promote: an admin opens **People** in the sidebar and sets roles; to let a manager edit a team, promote them to `manager` then assign them on the team page under **Managers**.
- The "last admin cannot be demoted" safeguard.

- [ ] **Step 2: Mark Phase 2-D done in the backlog**

In `ContextDB/todos/phase-2-backlog.md`, mark item **D — RBAC tiers** complete (match the file's existing done-marker convention) and link the spec (`../01_specs/phase-2-d-rbac-spec.md`) and this plan.

- [ ] **Step 3: Write the ADR**

Create `ContextDB/03_decisions/2026-06-26-rbac-role-tiers.md` capturing the locked decisions: three DB-backed tiers, first-login bootstrap (zero-admins rule), auto-provision-as-viewer, `team_managers` many-to-many scope, fresh-per-request role evaluation (not JWT-baked), two-step manager assignment. Note the alternatives considered (env allowlist; binary allowlist; single-owner column) and why they were rejected. Cross-link the spec.

- [ ] **Step 4: Update the data model doc**

In `ContextDB/02_architecture/data-model.md`, add `app_users` and `team_managers` (columns + the team-managers-vs-team-members distinction, and that `app_users` is keyed by Slack user_id).

- [ ] **Step 5: Full check + verification**

Run: `pnpm test`
Expected: PASS (includes `pnpm run check` — web lint + typecheck — and the full vitest run with the new RBAC tests).

- [ ] **Step 6: Commit**

```bash
git add README.md ContextDB/todos/phase-2-backlog.md ContextDB/03_decisions/2026-06-26-rbac-role-tiers.md ContextDB/02_architecture/data-model.md
git commit -m "docs(rbac): README + ContextDB for Phase 2-D role tiers"
```

- [ ] **Step 7: Live smoke (DoD step 2 — manual, requires a Slack dev workspace)**

Walk the getting-started runbook once: deploy with the migration applied, log in as the first user (confirm you land as admin / see **People**), log in as a second user (confirm viewer / no edit controls), promote them to manager and assign a team, confirm they can edit that team but not another. Record the walk in an `08_logs/` session note per the DoD checklist.

---

## Notes on Definition of Done

Per [CLAUDE.md](../../../CLAUDE.md) and the spec, the phase is done only when: `smoke:rbac` (and the full `pnpm test`) are green in CI; the live smoke runbook is walked once; the README reflects the role tiers + bootstrap; and the ContextDB backlog/ADR/data-model are updated. Tasks 7–8 cover items 1, 3, 4; task 8 step 7 covers item 2.
