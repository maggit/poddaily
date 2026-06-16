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
  const id = profile.sub ?? profile["https://slack.com/user_id"];
  if (!id) throw new Error("Slack profile missing both sub and user_id");
  return {
    id,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
  };
}
