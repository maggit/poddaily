import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface SlackStub {
  url: string;
  close: () => Promise<void>;
}

const STUB_USER = {
  sub: "U_ADMIN_STUB",
  "https://slack.com/user_id": "U_ADMIN_STUB",
  name: "Stub Admin",
  email: "admin@stub.local",
  picture: "https://stub.local/avatar.png",
};

export function startSlackStub(port = 4010): Promise<SlackStub> {
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");

    if (u.pathname === "/openid/connect/authorize") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const location = `${redirectUri}?code=STUB_CODE&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      return res.end();
    }

    if (u.pathname === "/api/openid.connect.token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        ok: true,
        access_token: "STUB_ACCESS_TOKEN",
        token_type: "Bearer",
        id_token: "stub.id.token",
      }));
    }

    if (u.pathname === "/api/openid.connect.userInfo") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, ...STUB_USER }));
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
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
