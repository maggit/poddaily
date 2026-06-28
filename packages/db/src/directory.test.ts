import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "./client";
import { upsertDirectoryUsers, searchDirectory, countDirectoryUsers, type DirectoryMemberInput } from "./directory";

const { db, sql } = createDb();

// All test ids share this prefix so cleanup is scoped and search assertions are isolated.
const P = "UDIR_";
function m(id: string, over: Partial<DirectoryMemberInput> = {}): DirectoryMemberInput {
  return {
    id: P + id,
    displayName: null, realName: null, email: null, avatarUrl: null, tz: null,
    isBot: false, deleted: false,
    ...over,
  };
}

async function wipe() {
  await sql`delete from slack_directory_users where slack_user_id like ${P + "%"}`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

const SEED: DirectoryMemberInput[] = [
  m("ADA", { displayName: "Ada Lovelace", realName: "Ada Lovelace", email: "ada@x.io", tz: "Europe/London" }),
  m("GRACE", { displayName: "Grace Hopper", realName: "Grace Hopper", email: "grace@x.io" }),
  m("GRACIELA", { displayName: "Graciela Ruiz", realName: "Graciela Ruiz", email: "graci@x.io" }),
  m("BOT", { displayName: "standupbot", isBot: true }),
  m("GONE", { displayName: "Gone Person", deleted: true }),
];

describe("slack directory data-access", () => {
  it("upserts (insert then update) and counts only selectable users", async () => {
    expect(await upsertDirectoryUsers(db, SEED)).toBe(5);
    // Bots + deactivated excluded from the count.
    expect(await countDirectoryUsers(db)).toBe(3);
    // Re-sync with a changed display name updates in place (no duplicate PK).
    await upsertDirectoryUsers(db, [m("ADA", { displayName: "Ada L.", email: "ada@x.io" })]);
    const [row] = await sql`select display_name from slack_directory_users where slack_user_id = ${P + "ADA"}`;
    expect(row.display_name).toBe("Ada L.");
    expect(await countDirectoryUsers(db)).toBe(3);
  });

  it("searches by name substring, excluding bots and deactivated users", async () => {
    await upsertDirectoryUsers(db, SEED);
    const { users } = await searchDirectory(db, "grac");
    const ids = users.map((u) => u.slackUserId);
    expect(ids).toContain(P + "GRACE");
    expect(ids).toContain(P + "GRACIELA");
    expect(ids).not.toContain(P + "ADA");
    expect(ids).not.toContain(P + "BOT");
    expect(ids).not.toContain(P + "GONE");
  });

  it("matches on email too", async () => {
    await upsertDirectoryUsers(db, SEED);
    const { users } = await searchDirectory(db, "ada@x");
    expect(users.map((u) => u.slackUserId)).toEqual([P + "ADA"]);
  });

  it("paginates with a stable nextOffset", async () => {
    await upsertDirectoryUsers(db, SEED);
    const page1 = await searchDirectory(db, "grac", { limit: 1, offset: 0 });
    expect(page1.users).toHaveLength(1);
    expect(page1.nextOffset).toBe(1);
    const page2 = await searchDirectory(db, "grac", { limit: 1, offset: 1 });
    expect(page2.users).toHaveLength(1);
    expect(page2.nextOffset).toBeNull(); // only 2 "grac*" matches → no third page
    expect(page1.users[0].slackUserId).not.toBe(page2.users[0].slackUserId);
  });

  it("empty query returns selectable users alphabetically", async () => {
    await upsertDirectoryUsers(db, SEED);
    const { users } = await searchDirectory(db, "   ", { limit: 10 });
    const names = users.map((u) => u.displayName);
    expect(names).toEqual([...names].sort());
    expect(users.map((u) => u.slackUserId)).not.toContain(P + "BOT");
  });
});
