import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* ambient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:22px_22px]"
      />

      <div className="reveal relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-accent-foreground shadow-sm">
          p
        </span>
        <h1 className="mt-5 font-heading text-2xl font-semibold tracking-tight text-foreground">poddaily</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to manage your team&apos;s standups.</p>
        <form
          className="mt-7"
          action={async () => {
            "use server";
            const { signIn } = await import("@/auth");
            await signIn("slack", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" size="lg" className="w-full">
            Sign in with Slack
          </Button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-subtle-foreground">
          Uses Slack&apos;s official OpenID Connect sign-in — your password never touches this
          site. poddaily is{" "}
          <a
            href="https://github.com/maggit/poddaily"
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            open source
          </a>
          .
        </p>
      </div>
    </main>
  );
}
