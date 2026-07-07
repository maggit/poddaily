import { redirect } from "next/navigation";
import type { UserRole } from "@poddaily/db/schema";
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
  // Dynamic import keeps next-auth out of the module graph during vitest runs,
  // since next-auth depends on next/server which is not available in that environment.
  const { auth } = await import("@/auth");
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
  if (!u) redirect("/team");
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
