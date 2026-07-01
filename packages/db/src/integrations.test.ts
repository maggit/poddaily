import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "./client";
import {
  getIntegrationSetting, upsertIntegrationSetting,
  upsertLinearActivity, countLinearActivity, pruneLinearActivity, listCompletedLinearIssues,
  resolveMemberEmail, listMemberLinearClosed, listUnmatchedLinearAssignees, countUnmatchedLinearAssignees,
  type LinearActivityInput,
} from "./integrations";

const { db, sql } = createDb();
const EMAIL = "ada+int@x.io";
const MEMBER = "U_INT_MEMBER";
const UNMATCHED = "nobody+int@x.io";

function issue(id: string, over: Partial<LinearActivityInput> = {}): LinearActivityInput {
  return {
    linearIssueId: id, identifier: "ENG-1", title: "t", url: "http://x", stateType: "completed",
    assigneeEmail: EMAIL, assigneeName: "Ada", completedAt: new Date("2026-06-29T10:00:00Z"),
    issueUpdatedAt: new Date("2026-06-29T10:00:00Z"),
    ...over,
  };
}

async function wipe() {
  await sql`delete from linear_activity where assignee_email in (${EMAIL}, ${UNMATCHED})`;
  await sql`delete from integration_settings where provider = 'test-provider'`;
  await sql`delete from slack_directory_users where slack_user_id = ${MEMBER}`;
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await sql.end(); });

describe("integration settings + linear activity", () => {
  it("upserts provider settings, changing only provided fields", async () => {
    await upsertIntegrationSetting(db, "test-provider", { secretCiphertext: "enc-1" });
    let s = await getIntegrationSetting(db, "test-provider");
    expect(s?.secretCiphertext).toBe("enc-1");
    expect(s?.enabled).toBe(false);
    // enabling later must not wipe the secret
    await upsertIntegrationSetting(db, "test-provider", { enabled: true });
    s = await getIntegrationSetting(db, "test-provider");
    expect(s?.enabled).toBe(true);
    expect(s?.secretCiphertext).toBe("enc-1");
  });

  it("upserts issue snapshots by id and lists completed issues in a window", async () => {
    await upsertLinearActivity(db, issue("iss-1", { identifier: "ENG-1" }));
    await upsertLinearActivity(db, issue("iss-2", { identifier: "ENG-2" }));
    // re-deliver iss-1 with a new title → update in place, no duplicate
    await upsertLinearActivity(db, issue("iss-1", { identifier: "ENG-1", title: "renamed" }));
    // a still-open issue and one completed outside the window must be excluded
    await upsertLinearActivity(db, issue("iss-3", { stateType: "started", completedAt: null }));
    await upsertLinearActivity(db, issue("iss-4", { completedAt: new Date("2026-06-20T10:00:00Z") }));

    expect(await countLinearActivity(db)).toBeGreaterThanOrEqual(4);

    const from = new Date("2026-06-29T00:00:00Z");
    const to = new Date("2026-06-30T00:00:00Z");
    const done = await listCompletedLinearIssues(db, EMAIL, from, to);
    const ids = done.map((d) => d.linearIssueId);
    expect(ids).toEqual(expect.arrayContaining(["iss-1", "iss-2"]));
    expect(ids).not.toContain("iss-3"); // not completed
    expect(ids).not.toContain("iss-4"); // completed before the window
    expect(done.find((d) => d.linearIssueId === "iss-1")?.title).toBe("renamed");
  });

  it("matches a member to their Linear activity by directory email", async () => {
    // member's Slack directory row carries the email Linear assigns issues to
    await sql`insert into slack_directory_users (slack_user_id, display_name, email) values (${MEMBER}, 'Ada', ${EMAIL})`;
    await upsertLinearActivity(db, issue("iss-m1", { identifier: "ENG-9" }));

    expect(await resolveMemberEmail(db, MEMBER)).toBe(EMAIL);
    const from = new Date("2026-06-29T00:00:00Z");
    const to = new Date("2026-06-30T00:00:00Z");
    const closed = await listMemberLinearClosed(db, MEMBER, from, to);
    expect(closed.map((c) => c.linearIssueId)).toContain("iss-m1");

    // an unknown member resolves to no email → no activity
    expect(await resolveMemberEmail(db, "U_NOBODY_XYZ")).toBeNull();
    expect(await listMemberLinearClosed(db, "U_NOBODY_XYZ", from, to)).toHaveLength(0);
  });

  it("lists Linear assignees with no matching poddaily member (case-insensitive)", async () => {
    // matched member (directory has the email in a DIFFERENT case → still matches)
    await sql`insert into slack_directory_users (slack_user_id, display_name, email) values (${MEMBER}, 'Ada', ${"ADA+INT@X.IO"})`;
    await upsertLinearActivity(db, issue("iss-match", { assigneeEmail: EMAIL, assigneeName: "Ada" }));
    // unmatched assignee — no directory/app_users row for this email
    await upsertLinearActivity(db, issue("iss-un1", { assigneeEmail: UNMATCHED, assigneeName: "Nobody" }));
    await upsertLinearActivity(db, issue("iss-un2", { assigneeEmail: UNMATCHED, assigneeName: "Nobody" }));

    const unmatched = await listUnmatchedLinearAssignees(db);
    const emails = unmatched.map((u) => u.email);
    expect(emails).toContain(UNMATCHED);
    expect(emails).not.toContain(EMAIL); // matched via case-insensitive directory email
    const row = unmatched.find((u) => u.email === UNMATCHED)!;
    expect(row.issueCount).toBe(2);
    expect(row.name).toBe("Nobody");

    // count + pagination
    expect(await countUnmatchedLinearAssignees(db)).toBeGreaterThanOrEqual(1);
    expect(await listUnmatchedLinearAssignees(db, { limit: 1, offset: 0 })).toHaveLength(1);
  });

  it("prunes activity older than the cutoff, keeping recent rows", async () => {
    await sql`insert into linear_activity (linear_issue_id, assignee_email, state_type, received_at) values ('iss-old', ${EMAIL}, 'completed', '2020-01-01T00:00:00Z')`;
    await upsertLinearActivity(db, issue("iss-new", { assigneeEmail: EMAIL }));

    const removed = await pruneLinearActivity(db, new Date("2021-01-01T00:00:00Z"));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await sql`select 1 from linear_activity where linear_issue_id = 'iss-old'`)[0]).toBeUndefined();
    expect((await sql`select 1 from linear_activity where linear_issue_id = 'iss-new'`)[0]).toBeTruthy();
  });
});
