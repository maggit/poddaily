import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { getCurrentUser } from "@/lib/authz";
import { signOut } from "@/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userName={me.name} isAdmin={me.role === "admin"} signOutAction={signOutAction} />
      <div className="flex flex-1 flex-col">
        <TopBar breadcrumb={<span>Home <span className="text-border">/</span> <span className="text-foreground">Teams</span></span>} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
