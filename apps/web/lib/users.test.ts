import { describe, it, expect, afterAll, beforeEach } from "vitest";
import {
  getAppUser, listAppUsers, countAdmins, provisionUserOnLogin, changeUserRole,
  LastAdminError, listTeamManagers, isTeamManager, addTeamManager, removeTeamManager,
  listManagerCandidates,
} from "./users";
import { createTeam } from "./teams";
import { sql } from "./db";

const U1 = "U_RBAC_1", U2 = "U_RBAC_2", U3 = "U_RBAC_3";
const CHAN = "C_RBAC_USERS";

async function wipe() {
  await sql`delete from team_managers where slack_user_id in (${U1}, ${U2}, ${U3})`;
  await sql`delete from app_users where slack_user_id in (${U1}, ${U2}, ${U3})`;
  await sql`delete from teams where slack_channel_id = ${CHAN}`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("app_users data access", () => {
  it("provisions the first user as admin only while no admin exists", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One", email: "one@x.io" });
    // U1 is the first user in a fresh wipe with zero admins -> admin
    expect((await getAppUser(U1))?.role).toBe("admin");
    // A second new user becomes a viewer (an admin now exists)
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    expect((await getAppUser(U2))?.role).toBe("viewer");
  });

  it("re-provisioning an existing user refreshes profile but keeps role", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" }); // admin (bootstrap)
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    await changeUserRole(U2, "admin");                                   // second admin first
    await changeUserRole(U1, "viewer");                                  // now safe to demote
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One Renamed", email: "new@x.io" });
    const u = await getAppUser(U1);
    expect(u?.role).toBe("viewer");           // unchanged by re-login
    expect(u?.displayName).toBe("One Renamed");
    expect(u?.email).toBe("new@x.io");
  });

  it("refuses to demote the last admin", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" }); // sole admin
    expect(await countAdmins()).toBe(1);
    await expect(changeUserRole(U1, "viewer")).rejects.toBeInstanceOf(LastAdminError);
    // With a second admin present, demotion is allowed.
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Two" });
    await changeUserRole(U2, "admin");
    await changeUserRole(U1, "manager");
    expect((await getAppUser(U1))?.role).toBe("manager");
  });

  it("lists manager candidates and manages team-manager links", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "Admin" }); // admin
    await provisionUserOnLogin({ slackUserId: U2, displayName: "Mgr" });
    await changeUserRole(U2, "manager");
    expect((await listManagerCandidates()).map((u) => u.slackUserId)).toContain(U2);

    const team = await createTeam({ name: "RBAC Pod", slackChannelId: CHAN, slackChannelName: "rbac" });
    expect(await isTeamManager(team.id, U2)).toBe(false);
    await addTeamManager(team.id, U2);
    await addTeamManager(team.id, U2); // idempotent
    expect(await isTeamManager(team.id, U2)).toBe(true);
    expect((await listTeamManagers(team.id)).map((u) => u.slackUserId)).toEqual([U2]);
    await removeTeamManager(team.id, U2);
    expect(await isTeamManager(team.id, U2)).toBe(false);
  });

  it("listAppUsers returns provisioned users", async () => {
    await provisionUserOnLogin({ slackUserId: U1, displayName: "One" });
    const ids = (await listAppUsers()).map((u) => u.slackUserId);
    expect(ids).toContain(U1);
  });
});
