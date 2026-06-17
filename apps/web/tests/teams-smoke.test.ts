import { describe, it, expect, afterAll } from "vitest";
import { createTeam, listTeams, addMember, listMembers, setMemberPermissions, removeMember, getTeam } from "../lib/teams";
import { sql } from "../lib/db";

const CHAN = "C_SMOKE_TEAM";
const USER = "U_SMOKE_TEAM";
afterAll(async () => {
  await sql`delete from team_members where slack_user_id = ${USER}`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
  await sql.end();
});

describe("smoke:team", () => {
  it("creates a team, adds a member with TZ, toggles perms, removes — end to end", async () => {
    await sql`delete from team_members where slack_user_id = ${USER}`;
    await sql`delete from teams where slack_channel_id = ${CHAN}`;

    const team = await createTeam({ name: "Smoke Pod", slackChannelId: CHAN, slackChannelName: "smoke-pod", tribe: "QA" });
    expect((await listTeams()).some((t) => t.id === team.id)).toBe(true);
    expect((await getTeam(team.id))?.name).toBe("Smoke Pod");

    const m = await addMember(team.id, { slackUserId: USER, slackDisplayName: "Smoke User", timezone: "Europe/London", canReport: true, canView: true, canEdit: false });
    let members = await listMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0].timezone).toBe("Europe/London");

    await setMemberPermissions(m.id, { canReport: false, canView: true, canEdit: true });
    members = await listMembers(team.id);
    expect(members[0].canEdit).toBe(true);
    expect(members[0].canReport).toBe(false);

    await removeMember(m.id);
    expect(await listMembers(team.id)).toHaveLength(0);
  });
});
