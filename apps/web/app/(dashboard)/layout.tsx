import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="mx-auto max-w-5xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <span className="text-lg font-semibold">poddaily</span>
        <span className="text-sm text-muted-foreground">{session.user?.name}</span>
      </header>
      {children}
    </div>
  );
}
