import { describe, it, expect, afterAll } from "vitest";
import { getStandup, upsertStandup } from "./standups";
import { createTeam } from "./teams";
import { sql } from "./db";
import { DEFAULT_QUESTIONS } from "@poddaily/shared";

const CHAN = "C_TEST_STANDUP";
let teamId: string;

afterAll(async () => {
  await sql`delete from standups where team_id = ${teamId}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("standup data access", () => {
  it("returns undefined when a team has no standup", async () => {
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const team = await createTeam({ name: "Cfg Pod", slackChannelId: CHAN, slackChannelName: "cfg-pod" });
    teamId = team.id;
    expect(await getStandup(teamId)).toBeUndefined();
  });

  it("creates a standup on first upsert", async () => {
    const s = await upsertStandup(teamId, {
      questions: DEFAULT_QUESTIONS,
      scheduleCron: "0 10 * * 1,2,3,4,5",
      scheduleTz: "America/Mexico_City",
      introMessage: "Hi!",
      outroMessage: "Thanks!",
    });
    expect(s.scheduleCron).toBe("0 10 * * 1,2,3,4,5");
    const got = await getStandup(teamId);
    expect(got?.introMessage).toBe("Hi!");
    expect((got?.questions as { text: string }[]).length).toBe(4);
  });

  it("updates the same standup on second upsert (one per team)", async () => {
    await upsertStandup(teamId, {
      questions: [{ id: "q1", text: "Only one?", type: "text" }],
      scheduleCron: "30 9 * * 1",
      scheduleTz: "Europe/London",
      introMessage: "Hello",
      outroMessage: "Bye",
    });
    const got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("30 9 * * 1");
    expect((got?.questions as unknown[]).length).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from standups where team_id = ${teamId}`;
    expect(count).toBe(1);
  });
});
