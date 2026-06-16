import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="font-serif text-4xl leading-none text-foreground">poddaily</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sign in to manage your team&apos;s standups.
        </p>
        <form
          className="mt-7"
          action={async () => {
            "use server";
            const { signIn } = await import("@/auth");
            await signIn("slack", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" variant="secondary" className="w-full gap-2">
            Sign in with Slack
          </Button>
        </form>
        <p className="mt-5 text-xs text-subtle-foreground">Internal engineers only</p>
      </div>
    </main>
  );
}
