import { NextResponse } from "next/server";
import { verifyState } from "../../../../../lib/oauth-state";
import { createDb, saveUserToken } from "@poddaily/db";

function page(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">` +
      `<h1>${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const secret = process.env.INTERNAL_API_SECRET ?? "";

  if (!code || !state || !verifyState(secret, state)) {
    return page("Couldn’t connect", "The link expired or was invalid. Please try connecting again from Slack.", 400);
  }

  const base = process.env.SLACK_OAUTH_BASE ?? "https://slack.com";
  const res = await fetch(`${base}/api/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/slack/oauth/callback`,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; authed_user?: { id?: string; access_token?: string; scope?: string } };
  if (!data.ok || !data.authed_user?.id || !data.authed_user.access_token) {
    return page("Couldn’t connect", "Slack did not return a user token. Please try again.", 400);
  }

  const { db } = createDb();
  await saveUserToken(db, secret, {
    slackUserId: data.authed_user.id,
    accessToken: data.authed_user.access_token,
    scopes: data.authed_user.scope ?? "chat:write",
  });
  return page("Connected ✅", "poddaily will now post your standups as you. You can close this tab.", 200);
}
