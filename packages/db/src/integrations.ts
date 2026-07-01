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
