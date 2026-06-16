import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">poddaily</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage your team&apos;s standups.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            const { signIn } = await import("@/auth");
            await signIn("slack", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="w-full">Sign in with Slack</Button>
        </form>
      </div>
    </main>
  );
}
