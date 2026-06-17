# Phase 1 — Step 3 (Part 2): Team & Member CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can create a team, see the teams list, open a team, and add/remove members with permissions and a captured timezone — all in the light app shell, served by Next.js against `@poddaily/db`, verified by `smoke:team`.

**Architecture:** Per the [admin-CRUD ADR](../03_decisions/2026-06-16-admin-crud-via-next-server.md), the admin app (`apps/web`) reads/writes the DB directly: a `@poddaily/db` singleton (`lib/db.ts`), a server-only-safe data-access layer (`lib/teams.ts`), Server Components for pages, and Server Actions for mutations. UI uses the Step 3 Part 1 design system (semantic classes only). No Slack dependency — members are added via a form with an IANA timezone field (the Slack-search auto-fill of members/TZ lands with the bot in Steps 5–6).

**Tech Stack:** Next.js 15 Server Components + Server Actions, Drizzle (`@poddaily/db`), Vitest, existing theme/shell.

Source: [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) §7–8 · [data-model](../02_architecture/data-model.md) · build step 3 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md).

> **Scope note (documented, not a gap):** member add is a manual form for now (slack user id,
> display name, timezone, permissions). Pulling members from the Slack workspace and
> auto-capturing TZ from `users.info` requires the bot (`users:read`) and lands in a later
> step. The data model already stores `timezone`, so this captures it today.

---

## File Structure

```
apps/web/
├─ lib/
│  ├─ db.ts            # @poddaily/db singleton (one pool per process)
│  └─ teams.ts         # data access: list/get/create teams; list/add/update/remove members
├─ app/(dashboard)/
│  ├─ dashboard/page.tsx        # Teams list (real data) + Create team button
│  └─ teams/
│     ├─ new/page.tsx           # Create-team form (Server Action)
│     └─ [id]/page.tsx          # Team detail: info + member table + add-member form
├─ components/
│  ├─ teams/
│  │  ├─ create-team-form.tsx   # form (client) → server action
│  │  ├─ member-table.tsx       # member rows + permission toggles + remove
│  │  └─ add-member-form.tsx     # add member (client) → server action
│  └─ ui/
│     ├─ data-table.tsx         # tiny themable Table primitive (thead/tbody styling)
│     └─ (button, status-pill, ...)
└─ tests/teams-smoke.test.ts    # smoke:team
packages/shared/src/timezones.ts # COMMON_TIMEZONES list (reused by the TZ dropdown)
```

---

### Task 1: DB singleton + wire `@poddaily/db` into the web app

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/db.ts`

- [ ] **Step 1: Add workspace deps**

Run: `pnpm --filter @poddaily/web add @poddaily/db@workspace:* @poddaily/shared@workspace:*`
Expected: both added; `pnpm install` clean.

- [ ] **Step 2: Create the DB singleton** — `apps/web/lib/db.ts`
```ts
import { createDb } from "@poddaily/db";

// One connection pool per process (survives Next dev HMR via globalThis).
const globalForDb = globalThis as unknown as { _poddailyDb?: ReturnType<typeof createDb> };
const instance = globalForDb._poddailyDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb._poddailyDb = instance;

export const db = instance.db;
export const sql = instance.sql;
```

- [ ] **Step 3: Verify it imports + connects** (DB is up + seeded)

Create throwaway `apps/web/lib/_check.ts`:
```ts
import { db } from "./db";
import { schema } from "@poddaily/db";
const rows = await db.select().from(schema.teams);
console.log("teams:", rows.length);
```
Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm --filter @poddaily/web exec tsx lib/_check.ts`
Expected: prints `teams: 1` (the seed). Then DELETE `apps/web/lib/_check.ts` (must NOT be committed).

- [ ] **Step 4: Commit**
```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/lib/db.ts
git commit -m "feat(web): @poddaily/db singleton for admin data access"
```

---

### Task 2: Timezone list in shared + data-access layer (TDD)

**Files:**
- Create: `packages/shared/src/timezones.ts`, `apps/web/lib/teams.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/web/lib/teams.test.ts`

- [ ] **Step 1: Timezones in shared** — `packages/shared/src/timezones.ts`
```ts
/** A curated IANA timezone shortlist for the member TZ picker. */
export const COMMON_TIMEZONES = [
  "America/Mexico_City",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
] as const;

export type Timezone = (typeof COMMON_TIMEZONES)[number];
```
Add `export * from "./timezones";` to `packages/shared/src/index.ts`.

- [ ] **Step 2: Write the failing test** — `apps/web/lib/teams.test.ts`
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createTeam, listTeams, getTeam, addMember, listMembers, setMemberPermissions, removeMember } from "./teams";
import { sql } from "./db";

const CHAN = "C_TEST_" + Math.floor(Math.random() * 1e6); // varied per run without Date/Math.random-in-script concerns
let teamId: string;

afterAll(async () => {
  await sql`delete from team_members where slack_user_id = 'U_TEST_1'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("teams data access", () => {
  it("creates a team and lists it", async () => {
    const team = await createTeam({ name: "Test Pod", slackChannelId: CHAN, slackChannelName: "test-pod", tribe: "QA" });
    teamId = team.id;
    expect(team.name).toBe("Test Pod");
    const all = await listTeams();
    expect(all.some((t) => t.id === teamId)).toBe(true);
  });

  it("adds a member with a timezone and lists members", async () => {
    await addMember(teamId, { slackUserId: "U_TEST_1", slackDisplayName: "Test User", timezone: "Europe/Madrid", canReport: true, canView: true, canEdit: false });
    const members = await listMembers(teamId);
    expect(members).toHaveLength(1);
    expect(members[0].timezone).toBe("Europe/Madrid");
  });

  it("updates permissions and removes the member", async () => {
    const [m] = await listMembers(teamId);
    await setMemberPermissions(m.id, { canReport: false, canView: true, canEdit: true });
    const [updated] = await listMembers(teamId);
    expect(updated.canEdit).toBe(true);
    expect(updated.canReport).toBe(false);
    await removeMember(m.id);
    expect(await listMembers(teamId)).toHaveLength(0);
  });

  it("getTeam returns the team", async () => {
    const t = await getTeam(teamId);
    expect(t?.slackChannelName).toBe("test-pod");
  });
});
```

- [ ] **Step 3: Run → FAIL** (`./teams` not found)
Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm vitest run apps/web/lib/teams.test.ts` — expect FAIL (module missing). Paste.

- [ ] **Step 4: Implement** — `apps/web/lib/teams.ts`
```ts
import { eq } from "drizzle-orm";
import { schema, type Team, type TeamMember } from "@poddaily/db";
import { db } from "./db";

export function listTeams(): Promise<Team[]> {
  return db.select().from(schema.teams).orderBy(schema.teams.name);
}

export async function getTeam(id: string): Promise<Team | undefined> {
  const [t] = await db.select().from(schema.teams).where(eq(schema.teams.id, id));
  return t;
}

export async function createTeam(input: {
  name: string; slackChannelId: string; slackChannelName: string; tribe?: string;
}): Promise<Team> {
  const [t] = await db.insert(schema.teams).values(input).returning();
  return t;
}

export function listMembers(teamId: string): Promise<TeamMember[]> {
  return db.select().from(schema.teamMembers).where(eq(schema.teamMembers.teamId, teamId)).orderBy(schema.teamMembers.slackDisplayName);
}

export async function addMember(teamId: string, input: {
  slackUserId: string; slackDisplayName: string; timezone: string;
  canReport: boolean; canView: boolean; canEdit: boolean;
}): Promise<TeamMember> {
  const [m] = await db.insert(schema.teamMembers).values({ teamId, ...input }).returning();
  return m;
}

export async function setMemberPermissions(memberId: string, perms: {
  canReport: boolean; canView: boolean; canEdit: boolean;
}): Promise<void> {
  await db.update(schema.teamMembers).set(perms).where(eq(schema.teamMembers.id, memberId));
}

export async function removeMember(memberId: string): Promise<void> {
  await db.delete(schema.teamMembers).where(eq(schema.teamMembers.id, memberId));
}
```

- [ ] **Step 5: Run → PASS** (4 tests). Paste.

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/timezones.ts packages/shared/src/index.ts apps/web/lib/teams.ts apps/web/lib/teams.test.ts
git commit -m "feat(web): teams/members data-access layer + timezone list (TDD)"
```

---

### Task 3: DataTable primitive + Teams list page (real data)

**Files:**
- Create: `apps/web/components/ui/data-table.tsx`
- Modify: `apps/web/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: DataTable primitive** — `apps/web/components/ui/data-table.tsx`

Themable table styling (semantic classes only).
```tsx
export function DataTable({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-muted text-[11px] uppercase tracking-wide text-subtle-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 text-left font-medium ${className}`}>{children}</th>;
}
export function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-t border-border px-4 py-3 align-middle ${className}`}>{children}</td>;
}
```

- [ ] **Step 2: Teams list page** — `apps/web/app/(dashboard)/dashboard/page.tsx`
```tsx
import Link from "next/link";
import { listTeams, listMembers } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, Th, Td } from "@/components/ui/data-table";

export default async function TeamsPage() {
  const teams = await listTeams();
  const counts = await Promise.all(teams.map((t) => listMembers(t.id).then((m) => m.length)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        actions={<Button asChild><Link href="/teams/new">Create team</Link></Button>}
      />
      {teams.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No teams yet. Create your first team to get started.
        </div>
      ) : (
        <DataTable head={<><Th>Team</Th><Th>Tribe</Th><Th>Members</Th><Th /></>}>
          {teams.map((t, i) => (
            <tr key={t.id} className="hover:bg-surface-muted">
              <Td>
                <Link href={`/teams/${t.id}`} className="font-medium text-foreground hover:text-accent">{t.name}</Link>
                <span className="ml-2 text-subtle-foreground">#{t.slackChannelName}</span>
              </Td>
              <Td className="text-muted-foreground">{t.tribe ?? "—"}</Td>
              <Td className="text-muted-foreground">{counts[i]}</Td>
              <Td className="text-right"><Link href={`/teams/${t.id}`} className="text-accent">Manage</Link></Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
```
If shadcn `Button` lacks `asChild`, wrap differently: render `<Link>` styled as a button, or put the link inside the button. Keep it semantic. Report what you used.

- [ ] **Step 3: Verify** — build + the seeded "Platform Pod" appears.
```bash
pnpm --filter @poddaily/web build
```
Expect success. (Dashboard is auth-gated; rendering is verified by build + the smoke/data tests. A signed-out request still redirects to /login.)

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/ui/data-table.tsx "apps/web/app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(web): teams list page with real data + DataTable primitive"
```

---

### Task 4: Create-team form + Server Action

**Files:**
- Create: `apps/web/app/(dashboard)/teams/new/page.tsx`, `apps/web/components/teams/create-team-form.tsx`

- [ ] **Step 1: Server Action + page** — `apps/web/app/(dashboard)/teams/new/page.tsx`
```tsx
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTeam } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { CreateTeamForm } from "@/components/teams/create-team-form";

async function createTeamAction(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const slackChannelName = String(formData.get("slackChannelName") ?? "").trim();
  const slackChannelId = String(formData.get("slackChannelId") ?? "").trim();
  const tribe = String(formData.get("tribe") ?? "").trim() || undefined;
  if (!name || !slackChannelName || !slackChannelId) {
    throw new Error("Name, channel name, and channel id are required");
  }
  const team = await createTeam({ name, slackChannelName, slackChannelId, tribe });
  revalidatePath("/dashboard");
  redirect(`/teams/${team.id}`);
}

export default function NewTeamPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Create team" />
      <CreateTeamForm action={createTeamAction} />
    </div>
  );
}
```

- [ ] **Step 2: The form (client)** — `apps/web/components/teams/create-team-form.tsx`
```tsx
import { Button } from "@/components/ui/button";

function Field({ label, name, placeholder, required }: { label: string; name: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">{label}{required ? <span className="text-danger"> *</span> : null}</span>
      <input name={name} placeholder={placeholder} required={required}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
    </label>
  );
}

export function CreateTeamForm({ action }: { action: (fd: FormData) => void }) {
  return (
    <form action={action} className="max-w-lg space-y-5 rounded-xl border border-border bg-card p-6">
      <Field label="Team name" name="name" placeholder="Platform Pod" required />
      <Field label="Tribe" name="tribe" placeholder="Infra" />
      <Field label="Slack channel name" name="slackChannelName" placeholder="platform-pod" required />
      <Field label="Slack channel ID" name="slackChannelId" placeholder="C0123456789" required />
      <p className="text-xs text-subtle-foreground">The Slack channel picker will replace manual entry once the bot is connected.</p>
      <div className="flex justify-end"><Button type="submit">Create team</Button></div>
    </form>
  );
}
```

- [ ] **Step 3: Verify** — `pnpm --filter @poddaily/web build` succeeds.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/app/(dashboard)/teams/new/page.tsx" apps/web/components/teams/create-team-form.tsx
git commit -m "feat(web): create-team form + server action"
```

---

### Task 5: Team detail page (info + members + add-member)

Builds the member-table and add-member-form components AND the team detail page that wires them
together with all four server actions — in one task so there are no forward references.

**Files:**
- Create: `apps/web/components/teams/member-table.tsx`, `apps/web/components/teams/add-member-form.tsx`, `apps/web/app/(dashboard)/teams/[id]/page.tsx`

- [ ] **Step 1: Member table (with permission toggles + remove)** — `apps/web/components/teams/member-table.tsx`
```tsx
import { DataTable, Th, Td } from "@/components/ui/data-table";
import type { TeamMember } from "@poddaily/db";

export function MemberTable({
  members, setPermAction, removeAction,
}: {
  members: TeamMember[];
  setPermAction: (fd: FormData) => void;
  removeAction: (fd: FormData) => void;
}) {
  if (members.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">No members yet. Add one below.</div>;
  }
  return (
    <DataTable head={<><Th>Member</Th><Th>Timezone</Th><Th className="text-center">View</Th><Th className="text-center">Report</Th><Th className="text-center">Edit</Th><Th /></>}>
      {members.map((m) => (
        <tr key={m.id} className="hover:bg-surface-muted">
          <Td><span className="font-medium text-foreground">{m.slackDisplayName}</span> <span className="text-subtle-foreground">{m.slackUserId}</span></Td>
          <Td className="text-muted-foreground">{m.timezone ?? "—"}</Td>
          {(["canView", "canReport", "canEdit"] as const).map((perm) => (
            <Td key={perm} className="text-center">
              <form action={setPermAction} className="inline">
                <input type="hidden" name="memberId" value={m.id} />
                <input type="hidden" name="canView" value={String(perm === "canView" ? !m.canView : m.canView)} />
                <input type="hidden" name="canReport" value={String(perm === "canReport" ? !m.canReport : m.canReport)} />
                <input type="hidden" name="canEdit" value={String(perm === "canEdit" ? !m.canEdit : m.canEdit)} />
                <button type="submit" aria-label={`toggle ${perm}`} className={`h-4 w-4 rounded border ${m[perm] ? "border-accent bg-accent" : "border-input bg-background"}`} />
              </form>
            </Td>
          ))}
          <Td className="text-right">
            <form action={removeAction} className="inline">
              <input type="hidden" name="memberId" value={m.id} />
              <button type="submit" className="text-danger hover:underline">Remove</button>
            </form>
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}
```

- [ ] **Step 2: Add-member form (captures TZ)** — `apps/web/components/teams/add-member-form.tsx`
```tsx
import { COMMON_TIMEZONES } from "@poddaily/shared";
import { Button } from "@/components/ui/button";

export function AddMemberForm({ action }: { action: (fd: FormData) => void }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Display name</span>
        <input name="slackDisplayName" required placeholder="Ada Lovelace" className="h-9 w-44 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Slack user ID</span>
        <input name="slackUserId" required placeholder="U0123456789" className="h-9 w-40 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </label>
      <label className="space-y-1.5">
        <span className="block text-[13px] font-medium">Timezone</span>
        <select name="timezone" defaultValue="America/Mexico_City" className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
          {COMMON_TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </label>
      <Button type="submit">Add member</Button>
    </form>
  );
}
```

- [ ] **Step 3: Team detail page wiring all four server actions** — `apps/web/app/(dashboard)/teams/[id]/page.tsx`
```tsx
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTeam, listMembers, addMember, setMemberPermissions, removeMember } from "@/lib/teams";
import { PageHeader } from "@/components/page-header";
import { MemberTable } from "@/components/teams/member-table";
import { AddMemberForm } from "@/components/teams/add-member-form";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();
  const members = await listMembers(id);

  async function addMemberAction(fd: FormData) {
    "use server";
    const slackUserId = String(fd.get("slackUserId") ?? "").trim();
    const slackDisplayName = String(fd.get("slackDisplayName") ?? "").trim();
    const timezone = String(fd.get("timezone") ?? "UTC");
    if (!slackUserId || !slackDisplayName) throw new Error("User id and display name are required");
    await addMember(id, { slackUserId, slackDisplayName, timezone, canReport: true, canView: true, canEdit: false });
    revalidatePath(`/teams/${id}`);
  }
  async function setPermAction(fd: FormData) {
    "use server";
    await setMemberPermissions(String(fd.get("memberId")), {
      canView: fd.get("canView") === "true",
      canReport: fd.get("canReport") === "true",
      canEdit: fd.get("canEdit") === "true",
    });
    revalidatePath(`/teams/${id}`);
  }
  async function removeAction(fd: FormData) {
    "use server";
    await removeMember(String(fd.get("memberId")));
    revalidatePath(`/teams/${id}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={team.name} />
      <div className="text-sm text-muted-foreground">#{team.slackChannelName}{team.tribe ? ` · ${team.tribe}` : ""}</div>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Members</h2>
        <MemberTable members={members} setPermAction={setPermAction} removeAction={removeAction} />
        <AddMemberForm action={addMemberAction} />
      </section>
    </div>
  );
}
```
Note: `params` is a Promise in Next 15 — `await params`. If the installed Next types treat `params` as a plain object, adapt (drop the `await`) and report.

- [ ] **Step 4: Verify** — `pnpm --filter @poddaily/web build` succeeds (the whole team detail flow compiles).

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/teams/[id]/page.tsx" apps/web/components/teams/member-table.tsx apps/web/components/teams/add-member-form.tsx
git commit -m "feat(web): team detail — member table, permission toggles, add-member with TZ"
```

---

### Task 6: `smoke:team` end-to-end check

**Files:**
- Create: `apps/web/tests/teams-smoke.test.ts`
- Modify: root `package.json`

- [ ] **Step 1: Smoke test** — `apps/web/tests/teams-smoke.test.ts`

End-to-end through the data layer (the same code the Server Actions call): create team → add member with TZ → list → update perms → remove → verify. Clean up.
```ts
import { describe, it, expect, afterAll } from "vitest";
import { createTeam, listTeams, addMember, listMembers, setMemberPermissions, removeMember, getTeam } from "../lib/teams";
import { sql } from "../lib/db";

const CHAN = "C_SMOKE_TEAM";
const USER = "U_SMOKE_TEAM";
afterAll(async () => {
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("smoke:team", () => {
  it("creates a team, adds a member with TZ, toggles perms, removes — end to end", async () => {
    await sql`delete from team_members where slack_user_id = ${USER}`;
    await sql`delete from teams where slack_channel_id = ${CHAN}`;

    const team = await createTeam({ name: "Smoke Pod", slackChannelId: CHAN, slackChannelName: "smoke-pod", tribe: "QA" });
    expect((await listTeams()).some((t) => t.id === team.id)).toBe(true);
    expect((await getTeam(team.id))?.name).toBe("Smoke Pod");

    const m = await addMember(team.id, { slackUserId: USER, slackDisplayName: "Smoke User", timezone: "Europe/London", canReport: true, canView: true, canEdit: false });
    let members = await listMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0].timezone).toBe("Europe/London");

    await setMemberPermissions(m.id, { canReport: false, canView: true, canEdit: true });
    members = await listMembers(team.id);
    expect(members[0].canEdit).toBe(true);
    expect(members[0].canReport).toBe(false);

    await removeMember(m.id);
    expect(await listMembers(team.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → PASS**
Run: `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm vitest run apps/web/tests/teams-smoke.test.ts` — expect PASS. Paste.

- [ ] **Step 3: Add `smoke:team` script** to root `package.json` scripts:
```json
"smoke:team": "vitest run apps/web/tests/teams-smoke.test.ts apps/web/lib/teams.test.ts"
```

- [ ] **Step 4: Run via script** — `export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"; pnpm smoke:team` → all pass. Paste.

- [ ] **Step 5: Commit**
```bash
git add apps/web/tests/teams-smoke.test.ts package.json
git commit -m "test(web): smoke:team — team + member CRUD end-to-end"
```

---

### Task 7: Definition-of-done updates (docs)

**Files:**
- Modify: `README.md`, `ContextDB/00_index/project-map.md`
- Create: `ContextDB/08_logs/2026-06-16-step3b-team-crud-build.md`

- [ ] **Step 1: Tick README feature items**
In `README.md`, change:
`- [ ] Team CRUD (name, Slack channel, tribe)` → `- [x] Team CRUD (name, Slack channel, tribe)`
`- [ ] Member management with per-member permissions + timezone capture` → `- [x] Member management with per-member permissions + timezone capture`

- [ ] **Step 2: Run the full suite** — `export DATABASE_URL=...; pnpm test` (expect all prior + new teams tests green) and `pnpm --filter @poddaily/web build`.

- [ ] **Step 3: Build log** — `ContextDB/08_logs/2026-06-16-step3b-team-crud-build.md`
```markdown
# 2026-06-16 — Step 3 Part 2 Build: Team & Member CRUD

Wired @poddaily/db into apps/web (singleton + data-access layer), built the teams list,
create-team form, and team detail with a member table (permission toggles + remove) and an
add-member form that captures an IANA timezone. All via Next Server Components + Server
Actions (admin-CRUD ADR). smoke:team green.

## Verification
- pnpm smoke:team: green (data-access + end-to-end CRUD).
- pnpm test: all green.
- pnpm --filter @poddaily/web build: success.

## Scope note
Member add is a manual form for now; Slack-workspace member search + automatic TZ capture
from users.info land with the bot (users:read) in a later step.

Next: build-order step 4 — standup configuration (questions + schedule) (smoke:config).
```

- [ ] **Step 4: Commit**
```bash
git add README.md ContextDB
git commit -m "docs: step 3 part 2 build log + README (team/member CRUD shipped)"
```

---

## Verification (end of Part 2)

- [ ] `pnpm smoke:team` passes (data-access + end-to-end CRUD).
- [ ] `pnpm test` passes (all suites).
- [ ] `pnpm --filter @poddaily/web build` succeeds.
- [ ] Teams list shows seeded "Platform Pod"; create-team works; team detail lists members; add/remove member + permission toggle work; timezone is captured and persisted.
- [ ] All UI uses semantic theme classes (reskinnable).

This produces real, viewable admin CRUD — the base for Step 4 (standup configuration).
