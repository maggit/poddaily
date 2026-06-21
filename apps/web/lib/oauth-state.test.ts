import { describe, it, expect } from "vitest";
import { signState, verifyState } from "./oauth-state";

const SECRET = "test-internal-api-secret-0123456789";

describe("oauth state", () => {
  it("verifies a freshly signed state", () => {
    const now = 1_000_000;
    const s = signState(SECRET, now);
    expect(verifyState(SECRET, s, now + 1000)).toBe(true);
  });
  it("rejects a tampered signature", () => {
    const s = signState(SECRET, 1_000_000);
    expect(verifyState(SECRET, s.slice(0, -1) + "0", 1_000_500)).toBe(false);
  });
  it("rejects a state signed with a different secret", () => {
    const s = signState("other-secret-aaaaaaaaaaaaaaaaaaaa", 1_000_000);
    expect(verifyState(SECRET, s, 1_000_500)).toBe(false);
  });
  it("rejects an expired state (> 10 min old)", () => {
    const s = signState(SECRET, 1_000_000);
    expect(verifyState(SECRET, s, 1_000_000 + 11 * 60 * 1000)).toBe(false);
  });
  it("rejects a malformed state", () => {
    expect(verifyState(SECRET, "not.a.valid.state", 1_000_000)).toBe(false);
  });
});
