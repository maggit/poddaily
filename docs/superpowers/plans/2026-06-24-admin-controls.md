# Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins pause/resume a standup (reusing `is_active`) and see, per member, whether they've connected their reporter user-OAuth token — both in the existing admin web UI.

**Architecture:** Two independent, small pieces on the existing Next.js Server-Component + server-action + `revalidatePath` pattern. Part A adds a `setStandupActive` data-access fn + a Pause/Resume control on the standup config page; pausing is effective immediately because `openRun` already guards on `isActive`. Part B adds a batch `listConnectedUserIds` db helper + a connected/not-connected pill column in `MemberTable`, composed in the team detail page. No worker, schema, smoke, or Slack-config changes.

**Tech Stack:** Next.js 15 App Router (Server Components + server actions), Drizzle (`@poddaily/db`), Vitest, Tailwind.

Source: [admin controls spec](../specs/2026-06-24-admin-controls-design.md).

---

## File Structure

```
packages/db/src/tokens.ts (+ index re-export)        # listConnectedUserIds (batch existence)
packages/db/src/tokens.test.ts                       # listConnectedUserIds tests
apps/web/lib/standups.ts (+ standups.test.ts)        # setStandupActive
apps/web/app/(dashboard)/teams/[id]/standup/page.tsx # status pill + Pause/Resume server action
apps/web/components/teams/member-table.tsx           # connected pill column (new prop)
apps/web/app/(dashboard)/teams/[id]/page.tsx         # compute connectedUserIds, pass prop
README.md · ContextDB/08_logs/2026-06-24-admin-controls.md   # DoD
```

---

### Task 1: `listConnectedUserIds` (batch token existence)

**Files:**
- Modify: `packages/db/src/tokens.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/tokens.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe("token store", ...)` block in `packages/db/src/tokens.test.ts`. Use a second user id; clean it up. Add `listConnectedUserIds` to the import from `./tokens`.

```ts
  it("listConnectedUserIds returns only connected ids (and [] for empty input)", async () => {
    const U2 = "U_TOK_TEST_2";
    await sql`delete from slack_user_tokens where slack_user_id = ${U2}`;
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-a", scopes: "chat:write" });
    // USER has a token; U2 does not
    const ids = await listConnectedUserIds(db, [USER, U2]);
    expect(ids).toEqual([USER]);
    expect(await listConnectedUserIds(db, [])).toEqual([]);
    await sql`delete from slack_user_tokens where slack_user_id = ${U2}`;
  });
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run packages/db/src/tokens.test.ts`
Expected: FAIL — `listConnectedUserIds is not a function` / not exported.

- [ ] **Step 3: Implement** — add to `packages/db/src/tokens.ts`. The file already imports `eq` from `drizzle-orm` and `* as schema`; add `inArray` to that import (`import { eq, inArray } from "drizzle-orm";`).

```ts
/** Which of the given users have connected (existence only, no decryption) — batch sibling of hasUserToken. */
export async function listConnectedUserIds(db: Db, slackUserIds: string[]): Promise<string[]> {
  if (slackUserIds.length === 0) return [];
  const rows = await db
    .select({ slackUserId: schema.slackUserTokens.slackUserId })
    .from(schema.slackUserTokens)
    .where(inArray(schema.slackUserTokens.slackUserId, slackUserIds));
  return rows.map((r) => r.slackUserId);
}
```

- [ ] **Step 4: Re-export from the db index** — in `packages/db/src/index.ts`, add `listConnectedUserIds` to the existing tokens re-export:

```ts
export { saveUserToken, getUserToken, hasUserToken, listConnectedUserIds } from "./tokens";
```

- [ ] **Step 5: Run, verify it passes**

Run: `pnpm exec vitest run packages/db/src/tokens.test.ts`
Expected: PASS (all token tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/tokens.ts packages/db/src/index.ts packages/db/src/tokens.test.ts
git commit -m "feat(db): listConnectedUserIds — batch token-existence query

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `setStandupActive` (pause/resume data access)

**Files:**
- Modify: `apps/web/lib/standups.ts`
- Test: `apps/web/lib/standups.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe("standup data access", ...)` block in `apps/web/lib/standups.test.ts`. It already creates a `teamId` with a standup (from the earlier `upsertStandup` test, which runs first in the same describe). Add `setStandupActive` to the import from `./standups`.

```ts
  it("setStandupActive pauses and resumes the standup (is_active)", async () => {
    await setStandupActive(teamId, false);
    let [row] = await sql`select is_active from standups where team_id = ${teamId}`;
    expect(row.is_active).toBe(false);
    await setStandupActive(teamId, true);
    [row] = await sql`select is_active from standups where team_id = ${teamId}`;
    expect(row.is_active).toBe(true);
  });
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run apps/web/lib/standups.test.ts`
Expected: FAIL — `setStandupActive is not a function`.

- [ ] **Step 3: Implement** — add to `apps/web/lib/standups.ts`:

```ts
/** Pause (active=false) or resume (active=true) a team's standup. Future-only: openRun bails on !is_active. */
export async function setStandupActive(teamId: string, active: boolean): Promise<void> {
  await db
    .update(schema.standups)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(schema.standups.teamId, teamId));
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm exec vitest run apps/web/lib/standups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/standups.ts apps/web/lib/standups.test.ts
git commit -m "feat(web): setStandupActive — pause/resume a standup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Pause/Resume control on the standup config page

**Files:**
- Modify: `apps/web/app/(dashboard)/teams/[id]/standup/page.tsx`

No new test (server-action wiring of the already-tested `setStandupActive`; the page is a thin composition). Verified by build + type-check.

- [ ] **Step 1: Add the server action + control to the page.** The page currently imports `getStandup, upsertStandup` from `@/lib/standups` and renders a `PageHeader` + `StandupForm`. Make these changes:

  (a) Extend the import: `import { getStandup, upsertStandup, setStandupActive } from "@/lib/standups";` and add `import { StatusPill } from "@/components/ui/status-pill";`.

  (b) After the `saveAction` server action (before the `return`), add a toggle action:

```ts
  async function toggleActiveAction() {
    "use server";
    const current = await getStandup(id);
    if (!current) return;
    await setStandupActive(id, !current.isActive);
    revalidatePath(`/teams/${id}/standup`);
  }
```

  (c) In the returned JSX, between the `<PageHeader .../>` and the `<StandupForm .../>`, render the status + toggle **only when a standup exists**. `standup` is already in scope (`const standup = await getStandup(id);`). `standup.isActive` is `boolean | null` (defaults true) — treat `=== false` as paused:

```tsx
      {standup ? (
        <div className="flex items-center gap-3">
          <StatusPill tone={standup.isActive === false ? "neutral" : "success"}>
            {standup.isActive === false ? "Paused" : "Active"}
          </StatusPill>
          <form action={toggleActiveAction}>
            <button type="submit" className="text-[13px] font-medium text-accent hover:underline">
              {standup.isActive === false ? "Resume standup" : "Pause standup"}
            </button>
          </form>
        </div>
      ) : null}
```

- [ ] **Step 2: Type-check + build the web app**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/teams/[id]/standup/page.tsx"
git commit -m "feat(web): pause/resume control on the standup config page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Connected badge column in `MemberTable`

**Files:**
- Modify: `apps/web/components/teams/member-table.tsx`, `apps/web/app/(dashboard)/teams/[id]/page.tsx`

No new test (presentational column + a page passing an already-tested helper's result). Verified by build + type-check.

- [ ] **Step 1: Add the `connectedUserIds` prop + column to `MemberTable`.** The component currently imports `DataTable, Th, Td` and `TeamMember`, takes `{ members, setPermAction, removeAction }`, and renders a table. Make these changes:

  (a) Add `import { StatusPill } from "@/components/ui/status-pill";`.

  (b) Add `connectedUserIds: string[]` to the props and build a `Set` once inside the component:

```tsx
export function MemberTable({
  members, connectedUserIds, setPermAction, removeAction,
}: {
  members: TeamMember[];
  connectedUserIds: string[];
  setPermAction: (fd: FormData) => void | Promise<void>;
  removeAction: (fd: FormData) => void | Promise<void>;
}) {
  const connected = new Set(connectedUserIds);
```

  (c) Add a header cell — change the `head=` to include a "Slack" column before the trailing empty `<Th />`:

```tsx
    <DataTable head={<><Th>Member</Th><Th>Timezone</Th><Th className="text-center">View</Th><Th className="text-center">Report</Th><Th className="text-center">Edit</Th><Th>Slack</Th><Th /></>}>
```

  (d) Add the body cell in each row, right before the trailing `<Td className="text-right">` (the Remove cell):

```tsx
          <Td>
            {connected.has(m.slackUserId)
              ? <StatusPill tone="success">Connected</StatusPill>
              : <StatusPill tone="neutral">Not connected</StatusPill>}
          </Td>
```

- [ ] **Step 2: Pass the prop from the team detail page.** In `apps/web/app/(dashboard)/teams/[id]/page.tsx`:

  (a) Extend the db import to get `listConnectedUserIds` and the `db` singleton. The page imports helpers from `@/lib/teams`; add `import { listConnectedUserIds } from "@poddaily/db";` and `import { db } from "@/lib/db";`.

  (b) After `const members = await listMembers(id);`, compute the connected ids:

```ts
  const connectedUserIds = await listConnectedUserIds(db, members.map((m) => m.slackUserId));
```

  (c) Pass it to the table: `<MemberTable members={members} connectedUserIds={connectedUserIds} setPermAction={setPermAction} removeAction={removeAction} />`.

- [ ] **Step 3: Type-check the web app**

Run: `pnpm --filter @poddaily/web exec tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/teams/member-table.tsx "apps/web/app/(dashboard)/teams/[id]/page.tsx"
git commit -m "feat(web): Slack-connected badge per member in the team detail table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Definition-of-done — docs + full verify

**Files:**
- Modify: `README.md`
- Create: `ContextDB/08_logs/2026-06-24-admin-controls.md`

- [ ] **Step 1: README** — in the admin/web section (near the "Reports dashboard" subsection), add a short "Admin controls" note: an admin can **pause/resume** a standup from its config page (`/teams/[id]/standup`) — pausing stops future scheduled runs (an in-flight run for today finishes); it takes effect at the next scheduled tick and the repeatable job is cleaned up on the next worker reconcile/boot. And the member table shows a **Slack-connected** badge per member (whether they've connected their reporter user-OAuth token → post as themselves vs. the bot fallback).

- [ ] **Step 2: Build log** — create `ContextDB/08_logs/2026-06-24-admin-controls.md` (follow prior logs): What shipped (Part A pause/resume via `is_active` + `setStandupActive`; Part B `listConnectedUserIds` + connected pill), Verification (`pnpm test` totals), Notable decisions (reuse `is_active`, no schema; future-only pause; effective at next tick via `openRun` guard, eventual repeatable-job cleanup at next reconcile; badge composed in the page so `listMembers` stays membership-only), and that this is Phase 2-C with B (reminders) + D (RBAC) still in the backlog.

- [ ] **Step 3: Full verification**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm test`
Expected: all green — paste the totals. If anything fails, STOP and report.

- [ ] **Step 4: Commit**

```bash
git add README.md ContextDB/08_logs/2026-06-24-admin-controls.md
git commit -m "docs: admin controls — pause/resume + connected badge (README, build log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Part A state/semantics (reuse `is_active`, future-only) → Tasks 2 + 3. ✓
- Part A effective-without-restart + eventual cleanup → documented in Task 3 control + Task 5 docs (behavior is inherent to the existing `openRun` guard; no code needed). ✓
- Part A control on the standup config page, shown only when a standup exists → Task 3. ✓
- Part B `listConnectedUserIds` batch helper (no decryption, `[]` on empty) → Task 1. ✓
- Part B wiring composed in the page, `listMembers` unchanged → Task 4. ✓
- Part B connected/not-connected pill via `StatusPill` → Task 4. ✓
- Testing (standups + tokens unit tests; no new smoke) → Tasks 1, 2, 5. ✓
- DoD docs → Task 5. ✓

**Placeholder scan:** every code step has complete code; no TBDs. ✓

**Type consistency:** `setStandupActive(teamId: string, active: boolean)` defined Task 2, used Task 3. `listConnectedUserIds(db, slackUserIds: string[]) → string[]` defined Task 1, used Task 4. `MemberTable` gains `connectedUserIds: string[]` in Task 4 and is supplied in the same task. `standup.isActive` is `boolean | null` — Task 3 treats `=== false` as paused (default `true` → "Active"). ✓
