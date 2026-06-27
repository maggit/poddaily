import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { onSignIn } from "./lib/auth-callbacks";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    signIn: onSignIn,
  },
});
