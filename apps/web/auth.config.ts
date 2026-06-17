import type { NextAuthConfig } from "next-auth";
// Relative import (not the @/ alias) so this file resolves under both Next and Vitest.
import { mapSlackProfile, type SlackOidcProfile } from "./lib/slack-profile";

const SLACK_BASE = process.env.SLACK_OIDC_BASE ?? "https://slack.com";

export const authConfig = {
  // Self-hosted behind a reverse proxy (Dokploy/Traefik) on a non-Vercel host — trust the
  // proxied host header, else Auth.js v5 throws UntrustedHost. Same as AUTH_TRUST_HOST=true.
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    {
      id: "slack",
      name: "Slack",
      type: "oauth",
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      checks: ["pkce", "state"],
      authorization: {
        url: `${SLACK_BASE}/openid/connect/authorize`,
        params: { scope: "openid profile email" },
      },
      token: `${SLACK_BASE}/api/openid.connect.token`,
      userinfo: `${SLACK_BASE}/api/openid.connect.userInfo`,
      profile(profile: SlackOidcProfile) {
        return mapSlackProfile(profile);
      },
    },
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
