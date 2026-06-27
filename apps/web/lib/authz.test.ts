import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { canEditTeamFor, canEditTeam, assertCanEditTeam, ForbiddenError, type CurrentUser } from "./authz";
import { provisionUserOnLogin, changeUserRole, addTeamManager } from "./users";
import { createTeam } from "./teams";
import { sql } from "./db";

const ADMIN = "U_AZ_ADMIN", MGR = "U_AZ_MGR", VIEWER = "U_AZ_VIEWER";
const CHAN = "C_AZ", CHAN2 = "C_AZ2";

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from app_users where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN}, ${CHAN2})`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

const user = (slackUserId: string, role: CurrentUser["role"]): CurrentUser => ({ slackUserId, role });

describe("canEditTeamFor (pure matrix)", () => {
  it("admin edits any team; manager only owned; viewer never", () => {
    expect(canEditTeamFor("admin", false)).toBe(true);
    expect(canEditTeamFor("admin", true)).toBe(true);
    expect(canEditTeamFor("manager", true)).toBe(true);
    expect(canEditTeamFor("manager", false)).toBe(false);
    expect(canEditTeamFor("viewer", true)).toBe(false);
    expect(canEditTeamFor("viewer", false)).toBe(false);
  });
});

describe("canEditTeam / assertCanEditTeam (against DB)", () => {
  it("scopes managers to their owned teams", async () => {
    await provisionUserOnLogin({ slackUserId: ADMIN, displayName: "Admin" }); // bootstrap admin
    await provisionUserOnLogin({ slackUserId: MGR, displayName: "Mgr" });
    await changeUserRole(MGR, "manager");
    await provisionUserOnLogin({ slackUserId: VIEWER, displayName: "Viewer" }); // viewer by default

    const owned = await createTeam({ name: "Owned", slackChannelId: CHAN, slackChannelName: "owned" });
    const other = await createTeam({ name: "Other", slackChannelId: CHAN2, slackChannelName: "other" });
    await addTeamManager(owned.id, MGR);

    expect(await canEditTeam(user(ADMIN, "admin"), other.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), owned.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), other.id)).toBe(false);
    expect(await canEditTeam(user(VIEWER, "viewer"), owned.id)).toBe(false);
    expect(await canEditTeam(null, owned.id)).toBe(false);

    await expect(assertCanEditTeam(user(MGR, "manager"), other.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertCanEditTeam(user(MGR, "manager"), owned.id)).resolves.toBeUndefined();
  });
});
