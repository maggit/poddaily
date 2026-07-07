import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/maggit/poddaily";

const FEATURES = [
  {
    title: "Standups over DM",
    body: "The bot DMs each member their questions in Slack, one at a time — skip a question, skip the day, or answer later. No meeting, no form.",
  },
  {
    title: "Posted as you",
    body: "Summaries land in the team channel attributed to the person who wrote them — real authorship, not a wall of bot messages.",
  },
  {
    title: "Timezone-aware",
    body: "Every member is asked on their own clock. A pod spread across four timezones still reads as one tidy thread each morning.",
  },
  {
    title: "Self-hosted, no per-seat cost",
    body: "Runs entirely on your own infrastructure — Next.js, Postgres, Redis. Your data stays with you, and nobody bills you per teammate.",
  },
];

const QUICK_START = `git clone ${GITHUB_URL}.git
cd poddaily && pnpm install
cp .env.example .env.local   # stub values work locally
pnpm db:migrate && pnpm seed
pnpm --filter @poddaily/web dev`;

const DM_MOCK: Array<{ from: "bot" | "user"; text: string }> = [
  { from: "bot", text: "Good morning! Time for the #eng-core standup. What did you work on yesterday?" },
  { from: "user", text: "Shipped the reports pagination fix" },
  { from: "bot", text: "Nice. What are you working on today?" },
];

const MOCK_CHECKINS = [
  {
    initials: "AK",
    name: "Ana K.",
    time: "9:02 AM",
    lines: [
      ["Yesterday", "shipped the reports pagination fix"],
      ["Today", "reviewing the scheduler retry PR"],
      ["Blockers", "none"],
    ],
  },
  {
    initials: "JM",
    name: "Jesús M.",
    time: "9:05 AM",
    lines: [
      ["Yesterday", "wired the Linear webhook into staging"],
      ["Today", "load-testing the queue worker"],
      ["Blockers", "waiting on a staging token"],
    ],
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="relative overflow-hidden">
        {/* ambient backdrop — same language as the app */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-accent/15 blur-[140px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:22px_22px]"
        />

        <div className="relative mx-auto max-w-5xl px-6">
          <header className="reveal flex items-center justify-between py-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-foreground shadow-sm">
                p
              </span>
              <span className="font-heading text-lg font-semibold tracking-tight">poddaily</span>
            </div>
            <nav className="flex items-center gap-2">
              <Button variant="ghost" size="sm" render={<a href="#quick-start" />}>
                Quick start
              </Button>
              <Button variant="outline" size="sm" render={<a href={GITHUB_URL} />}>
                GitHub
              </Button>
            </nav>
          </header>

          <main>
            <section className="grid items-center gap-12 py-14 md:grid-cols-[1.1fr_1fr] md:py-20">
              <div>
                <p
                  className="reveal font-mono text-xs uppercase tracking-[0.2em] text-accent-strong"
                  style={{ animationDelay: "60ms" }}
                >
                  Open source · Self-hosted · Slack-native
                </p>
                <h1
                  className="reveal mt-4 font-heading text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl"
                  style={{ animationDelay: "120ms" }}
                >
                  Daily standups,
                  <br />
                  without the meeting.
                </h1>
                <p
                  className="reveal mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground"
                  style={{ animationDelay: "180ms" }}
                >
                  poddaily asks each teammate their standup questions in a Slack DM, then posts one
                  clean summary to the team channel — written by them, attributed to them. Clone it,
                  run it on your own infrastructure, own your data.
                </p>
                <div className="reveal mt-8 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
                  <Button variant="accent" size="lg" render={<a href={GITHUB_URL} />}>
                    Get the code on GitHub
                  </Button>
                  <Button variant="outline" size="lg" render={<a href="#quick-start" />}>
                    Quick start
                  </Button>
                </div>
              </div>

              {/* the product in two beats: the DM conversation → the channel summary */}
              <div className="reveal space-y-3" style={{ animationDelay: "220ms" }}>
                <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    1 · Answer in a DM
                  </p>
                  <div className="mt-3 space-y-2">
                    {DM_MOCK.map((m, i) => (
                      <div key={i} className={m.from === "user" ? "flex justify-end" : "flex"}>
                        <p
                          className={
                            m.from === "user"
                              ? "max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-[13px] leading-snug text-accent-foreground"
                              : "max-w-[85%] rounded-xl rounded-bl-sm bg-secondary px-3 py-2 text-[13px] leading-snug text-secondary-foreground"
                          }
                        >
                          {m.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card shadow-lg">
                  <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                        2 · Read in the channel
                      </span>
                    </div>
                    <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-medium text-accent-strong">
                      Reported 2/5
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {MOCK_CHECKINS.map((c) => (
                      <li key={c.name} className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold text-secondary-foreground">
                            {c.initials}
                          </span>
                          <span className="text-sm font-medium">{c.name}</span>
                          <span className="font-mono text-[11px] text-subtle-foreground">{c.time}</span>
                        </div>
                        <dl className="mt-2 space-y-1 pl-[34px]">
                          {c.lines.map(([label, value]) => (
                            <div key={label} className="flex gap-2 text-[13px] leading-snug">
                              <dt className="w-[70px] shrink-0 text-subtle-foreground">{label}</dt>
                              <dd className="text-muted-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="border-t border-border py-14">
              <div className="grid gap-10 sm:grid-cols-2">
                {FEATURES.map((f, i) => (
                  <div key={f.title} className="reveal" style={{ animationDelay: `${i * 60}ms` }}>
                    <h2 className="font-heading text-base font-semibold tracking-tight">{f.title}</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="quick-start" className="scroll-mt-8 border-t border-border py-14">
              <div className="grid gap-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <h2 className="font-heading text-2xl font-semibold tracking-tight">Run it in minutes</h2>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Everything runs locally with a stubbed Slack — no external accounts needed to try
                    it. Deployment guides for Docker and Dokploy live in the repo, alongside the Slack
                    app manifest for connecting a real workspace.
                  </p>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    The stack: Next.js 15, Hono, BullMQ + Redis, PostgreSQL, Drizzle ORM, and{" "}
                    <span className="text-foreground">@slack/bolt</span>.
                  </p>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border bg-card p-5 shadow-card">
                  <pre className="font-mono text-[13px] leading-relaxed text-muted-foreground">
                    <code>{QUICK_START}</code>
                  </pre>
                </div>
              </div>
            </section>

            <section className="border-t border-border py-14">
              <h2 className="font-heading text-2xl font-semibold tracking-tight">Contributing</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                poddaily is built in the open and contributions are welcome — bug reports, feature
                ideas, docs, and pull requests alike. The roadmap and per-phase specs live in the
                repo, so it&apos;s easy to see what&apos;s planned and where help is most useful.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button variant="outline" size="sm" render={<a href={`${GITHUB_URL}/issues`} />}>
                  Open an issue
                </Button>
                <Button variant="outline" size="sm" render={<a href={`${GITHUB_URL}/pulls`} />}>
                  Send a pull request
                </Button>
                <Button variant="ghost" size="sm" render={<a href={`${GITHUB_URL}#roadmap`} />}>
                  Read the roadmap
                </Button>
              </div>
            </section>
          </main>

          <footer className="flex flex-col gap-2 border-t border-border py-8 text-xs text-subtle-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              poddaily — an open-source standup bot.{" "}
              <a href={GITHUB_URL} className="underline underline-offset-2 hover:text-muted-foreground">
                Source on GitHub
              </a>
            </p>
            <p>This deployment is a private instance for internal team use.</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
