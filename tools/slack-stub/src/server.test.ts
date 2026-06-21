import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "./server";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("slack oidc stub", () => {
  it("authorize redirects back to redirect_uri with code + state", async () => {
    const redirectUri = "http://localhost:3000/api/auth/callback/slack";
    const url = `${stub.url}/openid/connect/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=xyz&response_type=code&client_id=stub`;
    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain(`${redirectUri}?`);
    expect(location).toContain("code=");
    expect(location).toContain("state=xyz");
  });

  it("token endpoint returns an access_token", async () => {
    const res = await fetch(`${stub.url}/api/openid.connect.token`, { method: "POST" });
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe("Bearer");
  });

  it("userInfo returns a Slack OIDC profile", async () => {
    const res = await fetch(`${stub.url}/api/openid.connect.userInfo`, {
      headers: { authorization: "Bearer stub" },
    });
    const body = await res.json();
    expect(body.sub).toBeTruthy();
    expect(body["https://slack.com/user_id"]).toBeTruthy();
    expect(body.email).toContain("@");
  });
});

async function postForm(url: string, body: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("slack web api stub", () => {
  it("conversations.open returns a deterministic DM channel id", async () => {
    const res = await postForm(`${stub.url}/api/conversations.open`, { users: "U123" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.channel.id).toMatch(/^D/);
    // deterministic for the same user
    const res2 = await postForm(`${stub.url}/api/conversations.open`, { users: "U123" });
    expect((await res2.json()).channel.id).toBe(body.channel.id);
  });

  it("chat.postMessage records the message and returns a ts", async () => {
    await postForm(`${stub.url}/__stub/reset`, {});
    const res = await postForm(`${stub.url}/api/chat.postMessage`, { channel: "D1", text: "hello world" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ channel: "D1", text: "hello world" });
  });

  it("reset clears the recorded messages", async () => {
    await postForm(`${stub.url}/api/chat.postMessage`, { channel: "D1", text: "x" });
    await postForm(`${stub.url}/__stub/reset`, {});
    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toHaveLength(0);
  });

  it("records thread_ts/username/blocks on postMessage and chat.update", async () => {
    await postForm(`${stub.url}/__stub/reset`, {});
    await postForm(`${stub.url}/api/chat.postMessage`, {
      channel: "C1",
      text: "hi",
      thread_ts: "111.0",
      username: "Raquel",
      blocks: "[{}]",
    });
    await postForm(`${stub.url}/api/chat.update`, {
      channel: "C1",
      ts: "999.0",
      text: "Reported: 1 out of 1",
    });
    const msgs = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
    expect(msgs[0]).toMatchObject({ channel: "C1", text: "hi", thread_ts: "111.0", username: "Raquel" });
    const updates = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<Record<string, string>>;
    expect(updates[0]).toMatchObject({ channel: "C1", ts: "999.0", text: "Reported: 1 out of 1" });
  });

  it("fakes oauth.v2.access and records the Bearer token on postMessage", async () => {
    await postForm(`${stub.url}/__stub/reset`, {});
    const access = await (await fetch(`${stub.url}/api/oauth.v2.access`, { method: "POST" })).json();
    expect(access).toMatchObject({ ok: true, authed_user: { id: "U_STUB_USER", access_token: "xoxp-stub-user" } });
    await fetch(`${stub.url}/api/chat.postMessage`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer xoxp-stub-user" },
      body: new URLSearchParams({ channel: "C1", text: "as me" }),
    });
    const [msg] = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
    expect(msg).toMatchObject({ channel: "C1", token: "xoxp-stub-user" });
  });
});
