import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface SlackStub {
  url: string;
  close: () => Promise<void>;
}

export interface RecordedMessage {
  channel: string;
  text: string;
}

const STUB_USER = {
  sub: "U_ADMIN_STUB",
  "https://slack.com/user_id": "U_ADMIN_STUB",
  name: "Stub Admin",
  email: "admin@stub.local",
  picture: "https://stub.local/avatar.png",
};

function readBody(req: import("node:http").IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(new URLSearchParams(raw)));
  });
}

/** Deterministic fake DM channel id for a given user list. */
function dmChannelId(users: string): string {
  let hash = 0;
  for (const ch of users) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `D${hash.toString(36).toUpperCase()}`;
}

export function startSlackStub(port = 4010): Promise<SlackStub> {
  const messages: RecordedMessage[] = [];
  let tsCounter = 1000;

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    // --- OIDC (admin auth) ---
    if (u.pathname === "/openid/connect/authorize") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const location = `${redirectUri}?code=STUB_CODE&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      return res.end();
    }
    if (u.pathname === "/api/openid.connect.token") {
      return json(200, { ok: true, access_token: "STUB_ACCESS_TOKEN", token_type: "Bearer", id_token: "stub.id.token" });
    }
    if (u.pathname === "/api/openid.connect.userInfo") {
      return json(200, { ok: true, ...STUB_USER });
    }

    // --- Web API (bot) ---
    if (u.pathname === "/api/conversations.open") {
      const body = await readBody(req);
      const users = body.get("users") ?? "";
      return json(200, { ok: true, channel: { id: dmChannelId(users) } });
    }
    if (u.pathname === "/api/chat.postMessage") {
      const body = await readBody(req);
      messages.push({ channel: body.get("channel") ?? "", text: body.get("text") ?? "" });
      return json(200, { ok: true, ts: String(tsCounter++) });
    }

    // --- Test introspection ---
    if (u.pathname === "/__stub/messages") {
      return json(200, messages);
    }
    if (u.pathname === "/__stub/reset") {
      messages.length = 0;
      return json(200, { ok: true });
    }

    json(404, { ok: false, error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
