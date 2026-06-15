import { createDb } from "../src/index";

const REQUIRED_TABLES = [
  "teams", "team_members", "standups", "standup_runs",
  "standup_reports", "slack_user_tokens", "standup_reminders",
];

async function main() {
  const { sql } = createDb();
  let ok = true;

  const tableRows = await sql`
    select table_name from information_schema.tables where table_schema = 'public'
  `;
  const names = tableRows.map((r) => r.table_name);
  for (const t of REQUIRED_TABLES) {
    if (!names.includes(t)) { console.error(`✗ missing table: ${t}`); ok = false; }
  }

  const [{ count: teamCount }] = await sql`select count(*)::int as count from teams`;
  const [{ count: memberCount }] = await sql`select count(*)::int as count from team_members`;
  const [{ count: standupCount }] = await sql`select count(*)::int as count from standups`;
  if (teamCount < 1 || memberCount < 1 || standupCount < 1) {
    console.error(`✗ seed incomplete: teams=${teamCount} members=${memberCount} standups=${standupCount}`);
    ok = false;
  }

  await sql.end();
  if (!ok) { console.error("smoke:db FAILED"); process.exit(1); }
  console.log("✓ smoke:db PASSED — schema + seed + connectivity OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
