import type { Metadata } from "next";
import Image from "next/image";
import { GITHUB_URL, LandingShell } from "@/components/landing/shell";

export const metadata: Metadata = {
  title: "Team sign-in",
  description: "Sign in to poddaily with your Slack workspace account.",
};

const TICK_POSITIONS = ["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"] as const;

export default function LoginPage() {
  return (
    <LandingShell
      nav={[
        { href: "/", label: "Home" },
        { href: GITHUB_URL, label: "GitHub" },
      ]}
    >
      <main className="flex min-h-[70vh] items-center justify-center py-16">
        <div className="reveal w-full max-w-sm border border-border bg-card/80 p-8 text-center backdrop-blur-sm">
          <Image src="/logo.svg" alt="" width={64} height={64} unoptimized className="mx-auto h-16 w-16" />
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Team access</p>
          <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">poddaily</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Sign in to manage your team&apos;s standups.
          </p>
          <form
            className="mt-8"
            action={async () => {
              "use server";
              const { signIn } = await import("@/auth");
              await signIn("slack", { redirectTo: "/dashboard" });
            }}
          >
            <span className="group relative block">
              {TICK_POSITIONS.map((pos) => (
                <span
                  key={pos}
                  aria-hidden
                  className={`absolute ${pos} h-2 w-2 border-accent/70 ${
                    pos.includes("top") ? "border-t" : "border-b"
                  } ${pos.includes("left") ? "border-l" : "border-r"}`}
                />
              ))}
              <button
                type="submit"
                className="h-11 w-full border border-accent/60 bg-accent/10 text-sm font-medium tracking-tight text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Sign in with Slack
              </button>
            </span>
          </form>
          <p className="mt-6 text-xs leading-relaxed text-subtle-foreground">
            Uses Slack&apos;s official OpenID Connect sign-in — your password never touches this
            site. poddaily is{" "}
            <a
              href={GITHUB_URL}
              className="underline underline-offset-2 transition-colors hover:text-muted-foreground"
            >
              open source
            </a>
            .
          </p>
        </div>
      </main>
    </LandingShell>
  );
}
