import { NextResponse } from "next/server";
import { signState } from "../../../../lib/oauth-state";

export async function GET() {
  const base = process.env.SLACK_OAUTH_BASE ?? "https://slack.com";
  const url = new URL(`${base}/oauth/v2/authorize`);
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("user_scope", "chat:write");
  url.searchParams.set("redirect_uri", `${process.env.NEXTAUTH_URL}/api/slack/oauth/callback`);
  url.searchParams.set("state", signState(process.env.INTERNAL_API_SECRET ?? ""));
  return NextResponse.redirect(url.toString());
}
