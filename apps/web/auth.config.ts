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
      // OpenID Connect provider. Discovery at `${issuer}/.well-known/openid-configuration`
      // supplies the authorize/token/userInfo/jwks endpoints AND the expected id_token issuer,
      // so the `iss` claim ("https://slack.com") validates. (A generic "oauth" provider had no
      // issuer to check against → UntrustedHost/iss mismatch.)
      type: "oidc",
      issuer: SLACK_BASE,
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      // Slack always returns a `nonce` claim, so Auth.js must send + validate one — matches the
      // official next-auth Slack provider. (pkce/state alone left an empty nonce → rejected.)
      checks: ["nonce"],
      authorization: { params: { scope: "openid profile email" } },
      profile(profile: SlackOidcProfile) {
        return mapSlackProfile(profile);
      },
    },
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
