import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUser } from "@/lib/authz";
import { signOut } from "@/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/team");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/team" });
  }

  return (
    <AppShell userName={me.name} isAdmin={me.role === "admin"} signOutAction={signOutAction}>
      {children}
    </AppShell>
  );
}
