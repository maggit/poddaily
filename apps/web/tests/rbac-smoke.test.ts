import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { provisionUserOnLogin, changeUserRole, addTeamManager } from "../lib/users";
import { canEditTeam, canEditTeamFor, type CurrentUser } from "../lib/authz";
import { createTeam } from "../lib/teams";
import { sql } from "../lib/db";

const ADMIN = "U_SMK_ADMIN", MGR = "U_SMK_MGR", VIEWER = "U_SMK_VIEWER";
const CHAN_A = "C_SMK_A", CHAN_B = "C_SMK_B";
const user = (slackUserId: string, role: CurrentUser["role"]): CurrentUser => ({ slackUserId, role });

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from app_users where slack_user_id in (${ADMIN}, ${MGR}, ${VIEWER})`;
  await sql`delete from teams where slack_channel_id in (${CHAN_A}, ${CHAN_B})`;
}
beforeAll(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("smoke:rbac", () => {
  it("enforces the viewer/manager/admin matrix end to end", async () => {
    // Pure matrix sanity.
    expect(canEditTeamFor("manager", true)).toBe(true);
    expect(canEditTeamFor("manager", false)).toBe(false);

    // Bootstrap: first provisioned user (zero admins) is actually assigned the admin role in the DB.
    const bootstrapped = await provisionUserOnLogin({ slackUserId: ADMIN, displayName: "Admin" });
    expect(bootstrapped.role).toBe("admin");

    await provisionUserOnLogin({ slackUserId: MGR, displayName: "Mgr" });
    await changeUserRole(MGR, "manager");
    await provisionUserOnLogin({ slackUserId: VIEWER, displayName: "Viewer" }); // viewer

    const teamA = await createTeam({ name: "Pod A", slackChannelId: CHAN_A, slackChannelName: "pod-a" });
    const teamB = await createTeam({ name: "Pod B", slackChannelId: CHAN_B, slackChannelName: "pod-b" });
    await addTeamManager(teamA.id, MGR);

    expect(await canEditTeam(user(ADMIN, "admin"), teamB.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), teamA.id)).toBe(true);
    expect(await canEditTeam(user(MGR, "manager"), teamB.id)).toBe(false);
    expect(await canEditTeam(user(VIEWER, "viewer"), teamA.id)).toBe(false);
  });
});
