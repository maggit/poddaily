import { eq, schema } from "@poddaily/db";
import type { Standup } from "@poddaily/db/schema";
import type { Question } from "@poddaily/shared";
import { db } from "./db";

export interface StandupConfig {
  name?: string;
  questions: Question[];
  scheduleCron: string;
  scheduleTz: string;
  introMessage: string;
  outroMessage: string;
}

export async function getStandup(teamId: string): Promise<Standup | undefined> {
  const [s] = await db.select().from(schema.standups).where(eq(schema.standups.teamId, teamId));
  return s;
}

export async function upsertStandup(teamId: string, config: StandupConfig): Promise<Standup> {
  const values = {
    teamId,
    name: config.name ?? "Daily Standup",
    questions: config.questions,
    scheduleCron: config.scheduleCron,
    scheduleTz: config.scheduleTz,
    introMessage: config.introMessage,
    outroMessage: config.outroMessage,
    updatedAt: new Date(),
  };
  const [s] = await db
    .insert(schema.standups)
    .values(values)
    .onConflictDoUpdate({ target: schema.standups.teamId, set: values })
    .returning();
  return s;
}
