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
