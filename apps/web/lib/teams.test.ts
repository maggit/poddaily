import { describe, it, expect, afterAll } from "vitest";
import { createTeam, listTeams, getTeam, addMember, listMembers, setMemberPermissions, removeMember } from "./teams";
import { sql } from "./db";

const CHAN = "C_TEST_DATA";
let teamId: string;

afterAll(async () => {
  await sql`delete from team_members where slack_user_id = 'U_TEST_1'`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("teams data access", () => {
  it("creates a team and lists it", async () => {
    await sql`delete from teams where slack_channel_id = ${CHAN}`;
    const team = await createTeam({ name: "Test Pod", slackChannelId: CHAN, slackChannelName: "test-pod", tribe: "QA" });
    teamId = team.id;
    expect(team.name).toBe("Test Pod");
    const all = await listTeams();
    expect(all.some((t) => t.id === teamId)).toBe(true);
  });

  it("adds a member with a timezone and lists members", async () => {
    await addMember(teamId, { slackUserId: "U_TEST_1", slackDisplayName: "Test User", timezone: "Europe/Madrid", canReport: true, canView: true, canEdit: false });
    const members = await listMembers(teamId);
    expect(members).toHaveLength(1);
    expect(members[0].timezone).toBe("Europe/Madrid");
  });

  it("updates permissions and removes the member", async () => {
    const [m] = await listMembers(teamId);
    await setMemberPermissions(m.id, { canReport: false, canView: true, canEdit: true });
    const [updated] = await listMembers(teamId);
    expect(updated.canEdit).toBe(true);
    expect(updated.canReport).toBe(false);
    await removeMember(m.id);
    expect(await listMembers(teamId)).toHaveLength(0);
  });

  it("getTeam returns the team", async () => {
    const t = await getTeam(teamId);
    expect(t?.slackChannelName).toBe("test-pod");
  });
});
