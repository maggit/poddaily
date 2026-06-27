import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { onSignIn } from "./auth-callbacks";
import { getAppUser } from "./users";
import { sql } from "./db";

const A = "U_SIGNIN_A", B = "U_SIGNIN_B";
async function wipe() {
  await sql`delete from app_users where slack_user_id in (${A}, ${B})`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("onSignIn provisioning", () => {
  it("provisions the first user as admin and refuses login without an id", async () => {
    expect(await onSignIn({ user: { id: A, name: "Ada", email: "ada@x.io", image: "http://x/a.png" } })).toBe(true);
    const u = await getAppUser(A);
    expect(u?.role).toBe("admin");
    expect(u?.displayName).toBe("Ada");
    // Second user becomes viewer; still allowed in.
    expect(await onSignIn({ user: { id: B, name: "Bo" } })).toBe(true);
    expect((await getAppUser(B))?.role).toBe("viewer");
    // No id -> reject.
    expect(await onSignIn({ user: { id: null } })).toBe(false);
  });
});
