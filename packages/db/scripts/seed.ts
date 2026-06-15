import { eq } from "drizzle-orm";
import { createDb, schema } from "../src/index";
import { DEFAULT_QUESTIONS } from "@poddaily/shared";

async function main() {
  const { db, sql } = createDb();
  try {
    let [team] = await db
      .insert(schema.teams)
      .values({
        name: "Platform Pod",
        slackChannelId: "C_SEED_0001",
        slackChannelName: "platform-pod",
        tribe: "Infra",
      })
      .onConflictDoNothing({ target: schema.teams.slackChannelId })
      .returning();

    if (!team) {
      [team] = await db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.slackChannelId, "C_SEED_0001"));
    }

    await db
      .insert(schema.teamMembers)
      .values({
        teamId: team.id,
        slackUserId: "U_SEED_0001",
        slackDisplayName: "Seed Reporter",
        timezone: "America/Mexico_City",
        canReport: true,
      })
      .onConflictDoNothing();

    await db
      .insert(schema.standups)
      .values({
        teamId: team.id,
        questions: DEFAULT_QUESTIONS,
        scheduleCron: "0 10 * * 1-5",
        scheduleTz: "America/Mexico_City",
        introMessage: "Hi! Time for Daily Standup.",
        outroMessage: "Thanks for your update!",
      })
      .onConflictDoNothing();

    console.log(`Seeded team ${team.id} (Platform Pod) with 1 member + standup`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
