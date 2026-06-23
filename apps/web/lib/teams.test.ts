import { describe, it, expect, afterAll } from "vitest";
import { createTeam, listTeams, getTeam, addMember, listMembers, setMemberPermissions, removeMember, setMemberAvatar, listMembersMissingAvatar } from "./teams";
import { sql } from "./db";

const CHAN = "C_TEST_DATA";
let teamId: string;

afterAll(async () => {
  await sql`delete from team_members where slack_user_id in ('U_TEST_1', 'U_AV')`;
  await sql`delete from teams where slack_channel_id in (${CHAN}, 'C_AV')`;
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

  it("setMemberAvatar persists the avatar url; listMembersMissingAvatar excludes set ones", async () => {
    const team = await createTeam({ name: "Av Pod", slackChannelId: "C_AV", slackChannelName: "av" });
    const m = await addMember(team.id, { slackUserId: "U_AV", slackDisplayName: "Av", timezone: "UTC", canReport: true, canView: true, canEdit: false });
    expect(m.slackAvatarUrl).toBeNull();
    await setMemberAvatar(m.id, "https://x/av.png");
    const [row] = await listMembers(team.id);
    expect(row.slackAvatarUrl).toBe("https://x/av.png");
    const missing = await listMembersMissingAvatar();
    expect(missing.find((x) => x.id === m.id)).toBeUndefined();
  });
});
