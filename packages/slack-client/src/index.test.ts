import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { createSlackClient } from "./index";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("slack-client", () => {
  it("opens a DM and returns the channel id", async () => {
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const channelId = await client.openDm("U999");
    expect(channelId).toMatch(/^D/);
  });

  it("posts a message and returns its ts, recorded by the stub", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url });
    const ts = await client.postMessage("D1", "good morning");
    expect(ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toMatchObject([{ channel: "D1", text: "good morning" }]);
  });

  it("works when baseUrl already ends in /api (no double /api/api/)", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url + "/api" });
    const ts = await client.postMessage("D2", "trailing api test");
    expect(ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toMatchObject([{ channel: "D2", text: "trailing api test" }]);
  });

  it("postMessage forwards thread_ts / username / blocks", async () => {
    const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await client.postMessage("C_CHAN", "fallback", {
      threadTs: "100.5", username: "Raquel", iconUrl: "https://x/a.png", blocks: [{ type: "divider" }],
    });
    const [msg] = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
    expect(msg).toMatchObject({ channel: "C_CHAN", thread_ts: "100.5", username: "Raquel", icon_url: "https://x/a.png" });
  });

  it("updateMessage calls chat.update", async () => {
    const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    await client.updateMessage("C_CHAN", "200.7", { text: "Reported: 2 out of 3" });
    const [upd] = (await (await fetch(`${stub.url}/__stub/updates`)).json()) as Array<Record<string, string>>;
    expect(upd).toMatchObject({ channel: "C_CHAN", ts: "200.7", text: "Reported: 2 out of 3" });
  });

  it("getUserProfile returns image / tz / realName from users.info", async () => {
    const client = createSlackClient({ baseUrl: stub.url, token: "xoxb-test" });
    const p = await client.getUserProfile("U777");
    expect(p.image).toContain("U777");
    expect(p.tz).toBe("America/New_York");
    expect(p.realName).toBe("Stub User");
  });
});
