import { upsertDirectoryUsers } from "@poddaily/db";
import type { SlackClient } from "@poddaily/slack-client";
import type { Db } from "./types";

/**
 * Refresh the cached Slack workspace directory: pull the full member list (fully
 * paginated) and upsert it into `slack_directory_users`. Idempotent — safe to run on
 * a schedule and on demand. Returns the number of rows written.
 */
export async function syncDirectory(deps: { db: Db; slack: SlackClient }): Promise<number> {
  const members = await deps.slack.listAllUsers();
  const n = await upsertDirectoryUsers(deps.db, members);
  console.log(`[sync-directory] synced ${n} workspace members`);
  return n;
}
