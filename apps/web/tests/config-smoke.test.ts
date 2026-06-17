import { describe, it, expect, afterAll } from "vitest";
import { createTeam } from "../lib/teams";
import { getStandup, upsertStandup } from "../lib/standups";
import { sql } from "../lib/db";
import { DEFAULT_QUESTIONS, cronFromWeekly, parseWeeklyCron } from "@poddaily/shared";

const CHAN = "C_SMOKE_CONFIG";
let teamId: string;
afterAll(async () => {
  await sql`delete from standups where team_id = ${teamId}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("smoke:config", () => {
  it("configures a standup end to end and updates it", async () => {
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const team = await createTeam({ name: "Config Smoke", slackChannelId: CHAN, slackChannelName: "config-smoke" });
    teamId = team.id;
    expect(await getStandup(teamId)).toBeUndefined();

    const cron = cronFromWeekly({ weekdays: [1, 2, 3, 4, 5], hour: 10, minute: 0 });
    await upsertStandup(teamId, {
      questions: DEFAULT_QUESTIONS, scheduleCron: cron, scheduleTz: "America/Mexico_City",
      introMessage: "Hi!", outroMessage: "Thanks!",
    });
    let got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("0 10 * * 1,2,3,4,5");
    expect(parseWeeklyCron(got!.scheduleCron)).toEqual({ minute: 0, hour: 10, weekdays: [1, 2, 3, 4, 5] });
    expect((got?.questions as unknown[]).length).toBe(4);

    await upsertStandup(teamId, {
      questions: [{ id: "q1", text: "What's blocking you?", type: "text" }],
      scheduleCron: cronFromWeekly({ weekdays: [1], hour: 9, minute: 30 }),
      scheduleTz: "Europe/London", introMessage: "Morning", outroMessage: "Done",
    });
    got = await getStandup(teamId);
    expect(got?.scheduleCron).toBe("30 9 * * 1");
    expect(got?.scheduleTz).toBe("Europe/London");
    expect((got?.questions as unknown[]).length).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from standups where team_id = ${teamId}`;
    expect(count).toBe(1);
  });
});
