import { and, asc, eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { SlackDirectoryUser } from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

/** A normalized workspace member to persist (structurally matches slack-client's SlackMember). */
export interface DirectoryMemberInput {
  id: string;
  displayName: string | null;
  realName: string | null;
  email: string | null;
  avatarUrl: string | null;
  tz: string | null;
  isBot: boolean;
  deleted: boolean;
}

const t = schema.slackDirectoryUsers;

// The combined, lower-cased text the trigram GIN index is built on. Keep this expression
// byte-for-byte in sync with the index in migration 0006 so `ILIKE '%q%'` uses the index.
const SEARCH_EXPR = sql`lower(coalesce(${t.displayName}, '') || ' ' || coalesce(${t.realName}, '') || ' ' || coalesce(${t.email}, ''))`;

/** Bulk upsert the synced directory (chunked). Returns the number of rows written. */
export async function upsertDirectoryUsers(db: Db, members: DirectoryMemberInput[]): Promise<number> {
  const rows = members
    .filter((m) => m.id)
    .map((m) => ({
      slackUserId: m.id,
      displayName: m.displayName,
      realName: m.realName,
      email: m.email,
      avatarUrl: m.avatarUrl,
      tz: m.tz,
      isBot: m.isBot,
      deleted: m.deleted,
      updatedAt: new Date(),
    }));
  if (rows.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(t)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: t.slackUserId,
        set: {
          displayName: sql`excluded.display_name`,
          realName: sql`excluded.real_name`,
          email: sql`excluded.email`,
          avatarUrl: sql`excluded.avatar_url`,
          tz: sql`excluded.tz`,
          isBot: sql`excluded.is_bot`,
          deleted: sql`excluded.deleted`,
          updatedAt: sql`now()`,
        },
      });
  }
  return rows.length;
}

export interface DirectorySearchPage {
  users: SlackDirectoryUser[];
  /** Offset to pass for the next page, or null when there are no more results. */
  nextOffset: number | null;
}

/**
 * Search the synced directory by name/email. Excludes bots and deactivated users.
 * An empty query returns the directory alphabetically (useful for an initial dropdown).
 * Substring matches use the trigram index; results are ranked by trigram similarity.
 */
export async function searchDirectory(
  db: Db,
  query: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DirectorySearchPage> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);
  const active = and(eq(t.isBot, false), eq(t.deleted, false));
  const q = query.trim().toLowerCase();

  let rows: SlackDirectoryUser[];
  if (!q) {
    rows = await db
      .select()
      .from(t)
      .where(active)
      .orderBy(asc(sql`coalesce(${t.displayName}, ${t.realName}, ${t.slackUserId})`))
      .limit(limit + 1)
      .offset(offset);
  } else {
    // Escape LIKE metacharacters in the user-supplied query (backslash is the default escape).
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    rows = await db
      .select()
      .from(t)
      .where(and(active, sql`${SEARCH_EXPR} like ${pattern}`))
      .orderBy(sql`similarity(${SEARCH_EXPR}, ${q}) desc`, asc(sql`coalesce(${t.displayName}, ${t.realName})`))
      .limit(limit + 1)
      .offset(offset);
  }

  const hasMore = rows.length > limit;
  return { users: hasMore ? rows.slice(0, limit) : rows, nextOffset: hasMore ? offset + limit : null };
}

/** Count of selectable (non-bot, non-deleted) directory users — for the resync UI. */
export async function countDirectoryUsers(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.isBot, false), eq(t.deleted, false)));
  return row?.n ?? 0;
}
