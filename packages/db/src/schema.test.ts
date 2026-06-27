import { describe, it, expect, afterAll } from "vitest";
import { createDb } from "./client";

const { db, sql } = createDb();

afterAll(async () => { await sql.end(); });

describe("schema", () => {
  it("has all expected tables after migration", async () => {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
    `;
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "teams", "team_members", "standups", "standup_runs",
      "standup_reports", "slack_user_tokens", "standup_reminders",
      "app_users", "team_managers",
    ]) {
      expect(names).toContain(t);
    }
  });
});
