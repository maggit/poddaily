import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { IntegrationSetting, LinearActivity } from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

export async function getIntegrationSetting(db: Db, provider: string): Promise<IntegrationSetting | undefined> {
  const [row] = await db.select().from(schema.integrationSettings).where(eq(schema.integrationSettings.provider, provider));
  return row;
}

/** Upsert a provider's config. Only the provided fields are changed on an existing row. */
export async function upsertIntegrationSetting(
  db: Db,
  provider: string,
  patch: { enabled?: boolean; secretCiphertext?: string | null; config?: unknown },
): Promise<void> {
  await db
    .insert(schema.integrationSettings)
    .values({
      provider,
      enabled: patch.enabled ?? false,
      secretCiphertext: patch.secretCiphertext ?? null,
      config: (patch.config ?? null) as IntegrationSetting["config"],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.integrationSettings.provider,
      set: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.secretCiphertext !== undefined ? { secretCiphertext: patch.secretCiphertext } : {}),
        ...(patch.config !== undefined ? { config: patch.config as IntegrationSetting["config"] } : {}),
        updatedAt: new Date(),
      },
    });
}

export interface LinearActivityInput {
  linearIssueId: string;
  identifier: string | null;
  title: string | null;
  url: string | null;
  stateType: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  completedAt: Date | null;
  issueUpdatedAt: Date | null;
}

/** Upsert the latest snapshot of a Linear issue (keyed by its Linear id). */
export async function upsertLinearActivity(db: Db, a: LinearActivityInput): Promise<void> {
  await db
    .insert(schema.linearActivity)
    .values({ ...a, receivedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.linearActivity.linearIssueId,
      set: {
        identifier: a.identifier,
        title: a.title,
        url: a.url,
        stateType: a.stateType,
        assigneeEmail: a.assigneeEmail,
        assigneeName: a.assigneeName,
        completedAt: a.completedAt,
        issueUpdatedAt: a.issueUpdatedAt,
        receivedAt: new Date(),
      },
    });
}

/** Total issues we've stored (for the Integrations status UI). */
export async function countLinearActivity(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.linearActivity);
  return row?.n ?? 0;
}

/**
 * Issues assigned to `email` that Linear marked completed within [from, to). Phase 2 uses this
 * to build the "N tickets closed" line in a member's check-in.
 */
export function listCompletedLinearIssues(db: Db, email: string, from: Date, to: Date): Promise<LinearActivity[]> {
  return db
    .select()
    .from(schema.linearActivity)
    .where(
      and(
        eq(schema.linearActivity.assigneeEmail, email),
        eq(schema.linearActivity.stateType, "completed"),
        gte(schema.linearActivity.completedAt, from),
        lt(schema.linearActivity.completedAt, to),
      ),
    )
    .orderBy(desc(schema.linearActivity.completedAt));
}

/**
 * Resolve a Slack member's email. The synced workspace directory covers everyone, so try it
 * first; fall back to app_users (people who've logged into the web app). Null if unknown.
 */
export async function resolveMemberEmail(db: Db, slackUserId: string): Promise<string | null> {
  const [dir] = await db
    .select({ email: schema.slackDirectoryUsers.email })
    .from(schema.slackDirectoryUsers)
    .where(eq(schema.slackDirectoryUsers.slackUserId, slackUserId));
  if (dir?.email) return dir.email;
  const [au] = await db
    .select({ email: schema.appUsers.email })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.slackUserId, slackUserId));
  return au?.email ?? null;
}

/**
 * A standup member's Linear issues completed in [from, to) — resolves their email, then queries.
 * Empty if we can't match them to an email. This is the single entry point both the channel
 * broadcast and the report card use.
 */
export async function listMemberLinearClosed(db: Db, slackUserId: string, from: Date, to: Date): Promise<LinearActivity[]> {
  const email = await resolveMemberEmail(db, slackUserId);
  if (!email) return [];
  return listCompletedLinearIssues(db, email, from, to);
}
