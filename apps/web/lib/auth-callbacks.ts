import { provisionUserOnLogin } from "./users";

/**
 * NextAuth `signIn` callback. Provisions/refreshes the app_users row on every login
 * (first user while zero admins exist becomes admin; others become viewers). Lives in
 * the Node runtime via auth.ts — never imported into the edge auth.config.ts.
 */
export async function onSignIn(params: {
  user: { id?: string | null; name?: string | null; email?: string | null; image?: string | null };
}): Promise<boolean> {
  const id = params.user?.id;
  if (!id) return false;
  await provisionUserOnLogin({
    slackUserId: id,
    email: params.user.email ?? undefined,
    displayName: params.user.name ?? undefined,
    avatarUrl: params.user.image ?? undefined,
  });
  return true;
}
