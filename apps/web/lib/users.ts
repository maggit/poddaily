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
