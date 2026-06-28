import { NextResponse, type NextRequest } from "next/server";
import { searchDirectory } from "@poddaily/db";
import { getCurrentUser } from "@/lib/authz";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/directory/search?q=&offset= — autocomplete over the synced Slack directory. */
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);
  const { users, nextOffset } = await searchDirectory(db, q, { limit: 8, offset });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.slackUserId,
      displayName: u.displayName ?? u.realName ?? u.slackUserId,
      handle: u.slackUserId,
      email: u.email,
      avatarUrl: u.avatarUrl,
      tz: u.tz,
    })),
    nextOffset,
  });
}
