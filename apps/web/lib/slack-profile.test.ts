import { describe, it, expect } from "vitest";
import { mapSlackProfile } from "./slack-profile";

describe("mapSlackProfile", () => {
  it("maps a Slack OIDC profile to a session user", () => {
    const user = mapSlackProfile({
      sub: "U123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://img/ada.png",
      "https://slack.com/user_id": "U123",
    });
    expect(user).toEqual({
      id: "U123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: "https://img/ada.png",
    });
  });

  it("prefers the stable slack user_id claim over a rotating sub", () => {
    const user = mapSlackProfile({
      sub: "257dbbac-3090-4284-b3c0-93f39555cd4f", // opaque/rotating — must NOT be used
      name: "Raquel",
      email: "raquel@example.com",
      "https://slack.com/user_id": "U0123ABCD",
    });
    expect(user.id).toBe("U0123ABCD");
  });

  it("falls back to sub when the user_id claim is absent", () => {
    const user = mapSlackProfile({ sub: "U999", name: "Grace", email: "grace@example.com" });
    expect(user.id).toBe("U999");
  });
});
