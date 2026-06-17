import { eq } from "drizzle-orm";
import { schema } from "@poddaily/db";
import type { Team, TeamMember } from "@poddaily/db/schema";
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
