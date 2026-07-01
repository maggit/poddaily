import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLinearSignature, parseLinearIssueEvent } from "./linear";

describe("verifyLinearSignature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "Issue", action: "update" });
  const good = createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("accepts a correct signature", () => {
    expect(verifyLinearSignature(body, good, secret)).toBe(true);
  });
  it("rejects a wrong or missing signature", () => {
    expect(verifyLinearSignature(body, "deadbeef", secret)).toBe(false);
    expect(verifyLinearSignature(body, null, secret)).toBe(false);
    expect(verifyLinearSignature(body + "x", good, secret)).toBe(false);
  });
});

describe("parseLinearIssueEvent", () => {
  const completedIssue = {
    action: "update",
    type: "Issue",
    data: {
      id: "iss-uuid",
      identifier: "ENG-123",
      title: "Ship the thing",
      url: "https://linear.app/acme/issue/ENG-123",
      completedAt: "2026-06-29T18:00:00.000Z",
      updatedAt: "2026-06-29T18:00:01.000Z",
      state: { type: "completed" },
      assignee: { name: "Ada Lovelace", email: "ada@x.io" },
    },
  };

  it("maps an assigned completed issue to an activity snapshot", () => {
    const r = parseLinearIssueEvent(completedIssue);
    expect(r.kind).toBe("store");
    if (r.kind !== "store") throw new Error("expected store");
    expect(r.activity).toMatchObject({
      linearIssueId: "iss-uuid",
      identifier: "ENG-123",
      title: "Ship the thing",
      stateType: "completed",
      assigneeEmail: "ada@x.io",
      assigneeName: "Ada Lovelace",
    });
    expect(r.activity.completedAt?.toISOString()).toBe("2026-06-29T18:00:00.000Z");
  });

  it("skips non-issue types, removes, and unassigned issues — with a reason", () => {
    expect(parseLinearIssueEvent({ type: "Comment", action: "create", data: { id: "c1" } })).toMatchObject({ kind: "skip", reason: expect.stringContaining("non-issue") });
    expect(parseLinearIssueEvent({ ...completedIssue, action: "remove" })).toMatchObject({ kind: "skip", reason: "issue removed" });
    expect(parseLinearIssueEvent({ type: "Issue", action: "update", data: { id: "x", assignee: null } })).toMatchObject({ kind: "skip", reason: expect.stringContaining("unassigned") });
    expect(parseLinearIssueEvent({ type: "Issue", action: "update", data: {} })).toMatchObject({ kind: "skip", reason: expect.stringContaining("missing issue id") });
  });
});
