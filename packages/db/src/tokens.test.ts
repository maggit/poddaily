import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "./client";
import { saveUserToken, getUserToken, hasUserToken, listConnectedUserIds } from "./tokens";

const { db, sql } = createDb();
const SECRET = "test-internal-api-secret-0123456789";
const USER = "U_TOK_TEST";

beforeEach(async () => {
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
});
afterAll(async () => {
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
  await sql.end();
});

describe("token store", () => {
  it("saves encrypted (not plaintext) and reads back decrypted", async () => {
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-secret-token", scopes: "chat:write" });
    const [row] = await sql`select access_token from slack_user_tokens where slack_user_id = ${USER}`;
    expect(row.access_token).not.toContain("xoxp-secret-token");
    expect(await getUserToken(db, SECRET, USER)).toBe("xoxp-secret-token");
  });
  it("hasUserToken reflects existence without decrypting", async () => {
    expect(await hasUserToken(db, USER)).toBe(false);
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-x", scopes: "chat:write" });
    expect(await hasUserToken(db, USER)).toBe(true);
  });
  it("re-connect overwrites the token", async () => {
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-old", scopes: "chat:write" });
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-new", scopes: "chat:write" });
    expect(await getUserToken(db, SECRET, USER)).toBe("xoxp-new");
  });
  it("getUserToken returns null for an unknown user", async () => {
    expect(await getUserToken(db, SECRET, "U_NOPE")).toBeNull();
  });
  it("listConnectedUserIds returns only connected ids (and [] for empty input)", async () => {
    const U2 = "U_TOK_TEST_2";
    await sql`delete from slack_user_tokens where slack_user_id = ${U2}`;
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-a", scopes: "chat:write" });
    // USER has a token; U2 does not
    const ids = await listConnectedUserIds(db, [USER, U2]);
    expect(ids).toEqual([USER]);
    expect(await listConnectedUserIds(db, [])).toEqual([]);
    await sql`delete from slack_user_tokens where slack_user_id = ${U2}`;
  });
});
