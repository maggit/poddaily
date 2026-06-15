import { createDb, schema } from "../src/index";
import { DEFAULT_QUESTIONS } from "@poddaily/shared";

async function main() {
  const { db, sql } = createDb();

  const [team] = await db.insert(schema.teams).values({
    name: "Platform Pod",
    slackChannelId: "C_SEED_0001",
    slackChannelName: "platform-pod",
    tribe: "Infra",
  }).returning();

  await db.insert(schema.teamMembers).values({
    teamId: team.id,
    slackUserId: "U_SEED_0001",
    slackDisplayName: "Seed Reporter",
    timezone: "America/Mexico_City",
    canReport: true,
  });

  await db.insert(schema.standups).values({
    teamId: team.id,
    questions: DEFAULT_QUESTIONS,
    scheduleCron: "0 10 * * 1-5",
    scheduleTz: "America/Mexico_City",
    introMessage: "Hi! Time for Daily Standup.",
    outroMessage: "Thanks for your update!",
  });

  console.log(`Seeded team ${team.id} (Platform Pod) with 1 member + standup`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
