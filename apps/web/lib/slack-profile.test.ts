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

  it("falls back to the slack user_id claim when sub is absent", () => {
    const user = mapSlackProfile({
      name: "Grace",
      email: "grace@example.com",
      picture: "https://img/g.png",
      "https://slack.com/user_id": "U999",
    });
    expect(user.id).toBe("U999");
  });
});
