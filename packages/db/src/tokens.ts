import { eq } from "drizzle-orm";
import { encryptToken, decryptToken } from "@poddaily/shared";
import * as schema from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

/** Encrypt + upsert a reporter's user token. Re-connect overwrites. */
export async function saveUserToken(
  db: Db,
  secret: string,
  args: { slackUserId: string; accessToken: string; scopes: string },
): Promise<void> {
  const ciphertext = encryptToken(args.accessToken, secret);
  await db
    .insert(schema.slackUserTokens)
    .values({ slackUserId: args.slackUserId, accessToken: ciphertext, scopes: args.scopes })
    .onConflictDoUpdate({
      target: schema.slackUserTokens.slackUserId,
      set: { accessToken: ciphertext, scopes: args.scopes, authedAt: new Date() },
    });
}

/** Decrypt + return a reporter's user token, or null if not connected. */
export async function getUserToken(db: Db, secret: string, slackUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ token: schema.slackUserTokens.accessToken })
    .from(schema.slackUserTokens)
    .where(eq(schema.slackUserTokens.slackUserId, slackUserId));
  return row ? decryptToken(row.token, secret) : null;
}

/** Whether a reporter has connected — existence only, no decryption (for the worker). */
export async function hasUserToken(db: Db, slackUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.slackUserTokens.slackUserId })
    .from(schema.slackUserTokens)
    .where(eq(schema.slackUserTokens.slackUserId, slackUserId));
  return Boolean(row);
}
