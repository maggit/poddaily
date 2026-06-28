import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { createSlackClient } from "@poddaily/slack-client";
import { createDb } from "@poddaily/db";
import { syncDirectory } from "./syncDirectory";

const { db, sql } = createDb();
const STUB_IDS = ["U001", "U002", "U003", "B001"];
let stub: SlackStub;

beforeAll(async () => {
  stub = await startSlackStub(0);
});
afterAll(async () => {
  await sql`delete from slack_directory_users where slack_user_id in ${sql(STUB_IDS)}`;
  await stub.close();
  await sql.end();
});

describe("syncDirectory", () => {
  it("pulls the full member list and upserts it into the directory", async () => {
    const slack = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
    const written = await syncDirectory({ db, slack });
    expect(written).toBe(4); // 2 stub pages × 2 members, fully drained

    const rows = await sql`select slack_user_id, display_name, is_bot, deleted from slack_directory_users where slack_user_id in ${sql(STUB_IDS)} order by slack_user_id`;
    expect(rows.map((r) => r.slack_user_id)).toEqual(["B001", "U001", "U002", "U003"]);
    expect(rows.find((r) => r.slack_user_id === "U001")?.display_name).toBe("Ada Lovelace");
    expect(rows.find((r) => r.slack_user_id === "B001")?.is_bot).toBe(true);
    expect(rows.find((r) => r.slack_user_id === "U002")?.deleted).toBe(true);
  });
});
