import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, getUserToken, saveUserToken } from "@poddaily/db";
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

  it("binds the token to whoever authorized on Slack — never to the member whose report carried the link", async () => {
    // The connect link is identity-free (the state is just a signed timestamp), so even a
    // link clicked from ANOTHER member's report footer must bind to the authorizing user.
    // The stub always authorizes as U_STUB_USER; André must be untouched.
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await sql`delete from slack_user_tokens where slack_user_id in ('U_STUB_USER', 'U_ANDRE_BIND')`;
    await saveUserToken(db, SECRET, { slackUserId: "U_ANDRE_BIND", accessToken: "xoxp-andre-original", scopes: "chat:write" });

    const state = signState(SECRET); // same state a link in André's report footer would mint
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=${state}`));
    expect(res.status).toBe(200);

    // The authorizing user got the token; André's row is exactly as it was.
    expect(await getUserToken(db, SECRET, "U_STUB_USER")).toBe("xoxp-stub-user");
    expect(await getUserToken(db, SECRET, "U_ANDRE_BIND")).toBe("xoxp-andre-original");
    const rows = await sql`select slack_user_id from slack_user_tokens where slack_user_id in ('U_STUB_USER', 'U_ANDRE_BIND')`;
    expect(rows.map((r) => r.slack_user_id).sort()).toEqual(["U_ANDRE_BIND", "U_STUB_USER"]);

    await sql`delete from slack_user_tokens where slack_user_id in ('U_STUB_USER', 'U_ANDRE_BIND')`;
  });

  it("swaps the nudge footer on the latest bot-posted report for a connected note", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;

    const [team] = await sql`insert into teams (name, slack_channel_id, slack_channel_name) values ('Connect Pod', 'C_CONNECT_EDIT', 'connect-pod') returning id`;
    const [standup] = await sql`
      insert into standups (team_id, name, questions, schedule_cron, schedule_tz, is_active)
      values (${team.id}, 'Daily', ${JSON.stringify([{ id: "q1", text: "What did you do?", type: "text" }])}, '0 10 * * 1', 'UTC', true) returning id`;
    const [run] = await sql`insert into standup_runs (standup_id, scheduled_at, scheduled_date, status) values (${standup.id}, now(), current_date, 'completed') returning id`;
    await sql`
      insert into standup_reports (run_id, slack_user_id, slack_display_name, answers, status, channel_post_ts, posted_as, reported_at)
      values (${run.id}, 'U_STUB_USER', 'Stub User', ${JSON.stringify([{ questionId: "q1", questionText: "What did you do?", answer: "Shipped things" }])}, 'completed', '1234.5678', 'bot', now())`;

    const state = signState(SECRET);
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=${state}`));
    expect(res.status).toBe(200);

    const updates = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<{ channel: string; ts: string; blocks?: string }>;
    const edit = updates.find((u) => u.ts === "1234.5678");
    expect(edit).toBeTruthy();
    expect(edit!.channel).toBe("C_CONNECT_EDIT");
    expect(edit!.blocks).toContain("Stub User connected — future standups post as them");
    expect(edit!.blocks).toContain("Shipped things"); // report body rebuilt, not blanked
    expect(edit!.blocks).not.toContain("hasn't connected"); // stale nudge gone

    await sql`delete from standup_reports where run_id = ${run.id}`;
    await sql`delete from standup_runs where id = ${run.id}`;
    await sql`delete from standups where id = ${standup.id}`;
    await sql`delete from teams where id = ${team.id}`;
    await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
  });
});
