import { describe, it, expect, beforeAll } from "vitest";
import { GET } from "./route";

beforeAll(() => {
  process.env.SLACK_OAUTH_BASE = "https://slack.example";
  process.env.SLACK_CLIENT_ID = "CID";
  process.env.NEXTAUTH_URL = "https://web.example";
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret-0123456789";
});

describe("GET /api/slack/install", () => {
  it("redirects to Slack authorize with user_scope + signed state", async () => {
    const res = await GET();
    expect([307, 308]).toContain(res.status);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://slack.example/oauth/v2/authorize");
    expect(loc.searchParams.get("user_scope")).toBe("chat:write");
    expect(loc.searchParams.get("client_id")).toBe("CID");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://web.example/api/slack/oauth/callback");
    expect(loc.searchParams.get("state")).toMatch(/\w+\.\d+\.\w+/);
  });
});
