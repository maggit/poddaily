export interface SlackOidcProfile {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  "https://slack.com/user_id"?: string;
  [key: string]: unknown;
}

export interface SessionUser {
  id: string;
  name?: string;
  email?: string;
  image?: string;
}

export function mapSlackProfile(profile: SlackOidcProfile): SessionUser {
  // Slack's OIDC `sub` is NOT the workspace user id — it can be an opaque value that
  // rotates between logins (creating a new app_users row each time). The canonical,
  // stable Slack user id is the `https://slack.com/user_id` claim (e.g. "U0123ABCD"),
  // which also matches team_members/team_managers.slack_user_id. Prefer it; fall back
  // to `sub` only if the claim is somehow absent.
  const id = profile["https://slack.com/user_id"] ?? profile.sub;
  if (!id) throw new Error("Slack profile missing both user_id and sub");
  return {
    id,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
  };
}
