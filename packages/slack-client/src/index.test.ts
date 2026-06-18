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
    expect(log).toEqual([{ channel: "D1", text: "good morning" }]);
  });

  it("works when baseUrl already ends in /api (no double /api/api/)", async () => {
    await fetch(`${stub.url}/__stub/reset`, { method: "POST" });
    const client = createSlackClient({ token: "xoxb-test", baseUrl: stub.url + "/api" });
    const ts = await client.postMessage("D2", "trailing api test");
    expect(ts).toBeTruthy();

    const log = await (await fetch(`${stub.url}/__stub/messages`)).json();
    expect(log).toEqual([{ channel: "D2", text: "trailing api test" }]);
  });
});
