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

/** Delete Linear activity received before `olderThan` (retention). Returns rows removed. */
export async function pruneLinearActivity(db: Db, olderThan: Date): Promise<number> {
  const removed = await db
    .delete(schema.linearActivity)
    .where(lt(schema.linearActivity.receivedAt, olderThan))
    .returning({ id: schema.linearActivity.linearIssueId });
  return removed.length;
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
        eq(schema.linearActivity.assigneeEmail, email.trim().toLowerCase()),
        eq(schema.linearActivity.stateType, "completed"),
        gte(schema.linearActivity.completedAt, from),
        lt(schema.linearActivity.completedAt, to),
      ),
    )
    .orderBy(desc(schema.linearActivity.completedAt));
}

export interface UnmatchedAssignee {
  email: string;
  name: string | null;
  issueCount: number;
  lastActivityAt: Date | null;
}

// The NOT-EXISTS predicate shared by the list + count queries.
const UNMATCHED_WHERE = sql`
  la.assignee_email is not null
  and not exists (select 1 from slack_directory_users d where lower(d.email) = lower(la.assignee_email))
  and not exists (select 1 from app_users a where lower(a.email) = lower(la.assignee_email))
`;

/**
 * Distinct Linear assignee emails that have activity but match NO poddaily member
 * (no `slack_directory_users` or `app_users` row with that email, case-insensitive).
 * Their closed issues can't be surfaced — the admin fixes this by aligning emails. Paginated.
 */
export async function listUnmatchedLinearAssignees(
  db: Db,
  opts: { limit?: number; offset?: number } = {},
): Promise<UnmatchedAssignee[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = await db.execute(sql`
    select la.assignee_email as email,
           max(la.assignee_name) as name,
           count(*)::int as issue_count,
           max(coalesce(la.completed_at, la.received_at)) as last_activity
    from linear_activity la
    where ${UNMATCHED_WHERE}
    group by la.assignee_email
    order by count(*) desc
    limit ${limit} offset ${offset}
  `);
  return (rows as unknown as Array<{ email: string; name: string | null; issue_count: number; last_activity: string | null }>).map((r) => ({
    email: r.email,
    name: r.name,
    issueCount: Number(r.issue_count),
    lastActivityAt: r.last_activity ? new Date(r.last_activity) : null,
  }));
}

/** Count of distinct unmatched Linear assignee emails (for the summary badge). */
export async function countUnmatchedLinearAssignees(db: Db): Promise<number> {
  const rows = await db.execute(sql`
    select count(distinct la.assignee_email)::int as n
    from linear_activity la
    where ${UNMATCHED_WHERE}
  `);
  return Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
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
  if (dir?.email) return dir.email.trim().toLowerCase();
  const [au] = await db
    .select({ email: schema.appUsers.email })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.slackUserId, slackUserId));
  return au?.email ? au.email.trim().toLowerCase() : null;
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
