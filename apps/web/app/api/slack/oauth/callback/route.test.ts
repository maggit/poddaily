import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, getUserToken } from "@poddaily/db";
import { signState } from "../../../../../lib/oauth-state";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { GET } from "./route";

const { sql, db } = createDb();
const SECRET = "test-internal-api-secret-0123456789";
let stub: SlackStub;

beforeAll(async () => {
  stub = await startSlackStub(0);
  process.env.SLACK_OAUTH_BASE = stub.url;
  process.env.SLACK_API_BASE_URL = stub.url;
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_CLIENT_ID = "CID";
  process.env.SLACK_CLIENT_SECRET = "CSECRET";
  process.env.NEXTAUTH_URL = "https://web.example";
  process.env.INTERNAL_API_SECRET = SECRET;
  await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
});
afterAll(async () => {
  await stub.close();
  await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
  await sql.end();
});

describe("GET /api/slack/oauth/callback", () => {
  it("exchanges the code and stores the user token, then shows success", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    const state = signState(SECRET);
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=${state}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Connected");
    expect(await getUserToken(db, SECRET, "U_STUB_USER")).toBe("xoxp-stub-user");
    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ text: string }>;
    expect(msgs.some((m) => m.text.includes("connected"))).toBe(true);
  });
  it("rejects a bad state without storing anything", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=bad.state.sig`));
    expect(res.status).toBe(400);
    expect(await getUserToken(db, SECRET, "U_STUB_USER")).toBeNull();
    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<{ text: string }>;
    expect(msgs.length).toBe(0);
  });
});
