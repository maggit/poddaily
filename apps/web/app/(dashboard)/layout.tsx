import { redirect } from "next/navigation";
import { Sidebar } from "@/components/app-shell/sidebar";
import { TopBar } from "@/components/app-shell/top-bar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar userName={session.user?.name ?? undefined} />
      <div className="flex flex-1 flex-col">
        <TopBar breadcrumb={<span>Home <span className="text-border">/</span> <span className="text-foreground">Teams</span></span>} />
        <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
