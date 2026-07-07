import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // `api/integrations` holds public inbound webhooks (e.g. Linear) that must not be redirected
  // to the sign-in page. `team` is the sign-in page itself; `login` is its legacy redirect.
  // The dashboard search API stays protected (it's not excluded here).
  // NB: `team$` is anchored so the protected /teams/* dashboard routes still match.
  matcher: ["/((?!team$|install$|login|api/auth|api/integrations|_next/static|_next/image|favicon.ico|icon.svg|logo.svg).*)"],
};
