import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const SECRET = "test-internal-api-secret-0123456789";

describe("token crypto", () => {
  it("roundtrips a token", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    expect(enc).not.toContain("xoxp-abc-123");
    expect(decryptToken(enc, SECRET)).toBe("xoxp-abc-123");
  });
  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptToken("same", SECRET)).not.toBe(encryptToken("same", SECRET));
  });
  it("throws when decrypting with the wrong secret", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    expect(() => decryptToken(enc, "a-different-secret-whichiswrong-99")).toThrow();
  });
  it("throws when the payload is tampered", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptToken(raw.toString("base64"), SECRET)).toThrow();
  });
});
