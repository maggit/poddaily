import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // `api/integrations` holds public inbound webhooks (e.g. Linear) that must not be redirected
  // to /login. The dashboard search API stays protected (it's not excluded here).
  matcher: ["/((?!login|api/auth|api/integrations|_next/static|_next/image|favicon.ico).*)"],
};
