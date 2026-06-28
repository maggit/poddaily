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

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, manager: 1, admin: 2 };

/**
 * Upsert the user's profile on login.
 *
 * Identity is keyed on the Slack user id, but reconciled by **email**: a person keeps
 * a single row even if their stored slack_user_id ever changes (e.g. the historical
 * bug where Slack's rotating OIDC `sub` was stored instead of the stable user id). If
 * a login arrives with an id we haven't seen but an email we have, we adopt the
 * existing row's role (the highest among any duplicates) and drop the stale row(s) —
 * self-healing duplicate users.
 *
 * The first user provisioned while zero admins exist becomes an admin; every other
 * genuinely new user defaults to viewer. Existing users keep their role and only have
 * profile + last_login_at refreshed.
 */
export async function provisionUserOnLogin(input: {
  slackUserId: string; email?: string; displayName?: string; avatarUrl?: string;
}): Promise<AppUser> {
  await db.transaction(async (tx) => {
    const [byId] = await tx.select().from(schema.appUsers).where(eq(schema.appUsers.slackUserId, input.slackUserId));
    if (byId) {
      await tx.update(schema.appUsers).set({
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        lastLoginAt: dsql`now()`,
      }).where(eq(schema.appUsers.slackUserId, input.slackUserId));
      return;
    }

    // No row for this Slack id yet — reconcile by email before creating a new one.
    let role: UserRole = "viewer";
    let reconciled = false;
    if (input.email) {
      const sameEmail = await tx.select().from(schema.appUsers).where(eq(schema.appUsers.email, input.email));
      if (sameEmail.length > 0) {
        reconciled = true;
        role = sameEmail.reduce<UserRole>((best, r) => (ROLE_RANK[r.role] > ROLE_RANK[best] ? r.role : best), "viewer");
        // Remove the stale row(s); team_managers rows referencing them cascade away.
        await tx.delete(schema.appUsers).where(inArray(schema.appUsers.slackUserId, sameEmail.map((r) => r.slackUserId)));
      }
    }

    // Bootstrap the very first user (only when we're not adopting an existing identity).
    if (!reconciled) {
      const [row] = await tx
        .select({ n: dsql<number>`count(*)::int` })
        .from(schema.appUsers)
        .where(eq(schema.appUsers.role, "admin"));
      if ((row?.n ?? 0) === 0) role = "admin";
    }

    await tx.insert(schema.appUsers).values({
      slackUserId: input.slackUserId,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      role,
      lastLoginAt: dsql`now()`,
    });
  });
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
