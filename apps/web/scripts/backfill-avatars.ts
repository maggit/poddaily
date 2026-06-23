import { createSlackClient } from "@poddaily/slack-client";
import { listMembersMissingAvatar, setMemberAvatar } from "../lib/teams";
import { sql } from "../lib/db";

async function main() {
  const slack = createSlackClient();
  const members = await listMembersMissingAvatar();
  console.log(`[backfill] ${members.length} member(s) missing an avatar`);
  for (const m of members) {
    try {
      const p = await slack.getUserProfile(m.slackUserId);
      if (p.image) { await setMemberAvatar(m.id, p.image); console.log(`[backfill] set avatar for ${m.slackUserId}`); }
      else console.log(`[backfill] no image for ${m.slackUserId}`);
    } catch (err) {
      console.warn(`[backfill] failed for ${m.slackUserId}:`, (err as Error).message);
    }
  }
  await sql.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
