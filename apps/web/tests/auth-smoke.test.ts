import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "../../../tools/slack-stub/src/server";
import { mapSlackProfile } from "../lib/slack-profile";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("smoke:auth", () => {
  it("stub serves a Slack identity that maps to a session user", async () => {
    const tokenRes = await fetch(`${stub.url}/api/openid.connect.token`, { method: "POST" });
    expect((await tokenRes.json()).access_token).toBeTruthy();

    const infoRes = await fetch(`${stub.url}/api/openid.connect.userInfo`, {
      headers: { authorization: "Bearer STUB_ACCESS_TOKEN" },
    });
    const profile = await infoRes.json();
    const user = mapSlackProfile(profile);
    expect(user.id).toBe("U_ADMIN_STUB");
    expect(user.email).toContain("@");
  });

  it("middleware authorization logic denies an unauthenticated request", async () => {
    const { authConfig } = await import("../auth.config");
    const result = authConfig.callbacks!.authorized!({
      auth: null,
      request: new Request("http://localhost:3000/dashboard"),
    } as never);
    expect(result).toBe(false);
  });
});
