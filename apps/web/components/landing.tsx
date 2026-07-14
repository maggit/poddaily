"use client";

import { GITHUB_URL, LandingShell, TickButton } from "@/components/landing/shell";

const FEATURES = [
  {
    n: "01",
    title: "Standups over DM",
    body: "The bot DMs each member their questions in Slack, one at a time — skip a question, skip the day, or answer later. No meeting, no form.",
  },
  {
    n: "02",
    title: "Posted as you",
    body: "Summaries land in the team channel attributed to the person who wrote them — real authorship, not a wall of bot messages.",
  },
  {
    n: "03",
    title: "Timezone-aware",
    body: "Every member is asked on their own clock. A pod spread across four timezones still reads as one tidy thread each morning.",
  },
  {
    n: "04",
    title: "Reminders & catch-up",
    body: "Gentle DM nudges until a check-in is done, plus a redo keyword and a /standup command to catch up on a missed day — nobody gets silently dropped.",
  },
  {
    n: "05",
    title: "Linear integration",
    body: "A signature-verified webhook matches Linear issues to team members by email, so each person's closed issues show up alongside their check-ins in reports.",
  },
  {
    n: "06",
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

export function Landing({
  official = false,
  instanceName = null,
}: {
  official?: boolean;
  instanceName?: string | null;
}) {
  return (
    <LandingShell
      official={official}
      instanceName={instanceName}
      nav={[
        { href: "#quick-start", label: "Quick start" },
        { href: "/install", label: "Install" },
        { href: GITHUB_URL, label: "GitHub" },
      ]}
    >
      <main>
        <section className="grid items-center gap-12 py-16 md:grid-cols-[1.15fr_1fr] md:py-24">
          <div>
            <p
              className="reveal font-mono text-[11px] uppercase tracking-[0.25em] text-accent"
              style={{ animationDelay: "60ms" }}
            >
              Open source · Self-hosted · Slack-native
            </p>
            <h1
              className="reveal landing-hero-text mt-5 font-heading text-5xl font-extrabold leading-[1.02] tracking-tight md:text-[4.4rem]"
              style={{ animationDelay: "120ms" }}
            >
              Daily standups, without the meeting.
            </h1>
            <p
              className="reveal mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground"
              style={{ animationDelay: "180ms" }}
            >
              poddaily asks each teammate their standup questions in a Slack DM, then posts one
              clean summary to the team channel — written by them, attributed to them. Clone it,
              run it on your own infrastructure, own your data.
            </p>
            <div className="reveal mt-9 flex flex-wrap gap-4" style={{ animationDelay: "240ms" }}>
              <TickButton href={GITHUB_URL} primary>
                Get the code on GitHub
              </TickButton>
              <TickButton href="/install">Installation guide</TickButton>
            </div>
          </div>

          {/* the product in two beats: the DM conversation → the channel summary */}
          <div className="reveal space-y-3" style={{ animationDelay: "220ms" }}>
            <div className="border border-border bg-card/80 p-4 backdrop-blur-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground">
                1 · Answer in a DM
              </p>
              <div className="mt-3 space-y-2">
                {DM_MOCK.map((m, i) => (
                  <div key={i} className={m.from === "user" ? "flex justify-end" : "flex"}>
                    <p
                      className={
                        m.from === "user"
                          ? "max-w-[85%] border border-accent/40 bg-accent/15 px-3 py-2 text-[13px] leading-snug text-foreground"
                          : "max-w-[85%] border border-border bg-secondary px-3 py-2 text-[13px] leading-snug text-secondary-foreground"
                      }
                    >
                      {m.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-border bg-card/80 backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground">
                  2 · Read in the channel
                </span>
                <span className="border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
                  Reported 2/5
                </span>
              </div>
              <ul className="divide-y divide-border">
                {MOCK_CHECKINS.map((c) => (
                  <li key={c.name} className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 items-center justify-center bg-secondary font-mono text-[10px] font-semibold text-secondary-foreground">
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

        <section className="border-t border-border py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">What it does</p>
          <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.n} className="group bg-background p-7 transition-colors hover:bg-card">
                <span className="font-mono text-[11px] text-subtle-foreground transition-colors group-hover:text-accent">
                  {f.n}
                </span>
                <h2 className="mt-3 font-heading text-xl font-bold tracking-tight">{f.title}</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="quick-start" className="scroll-mt-8 border-t border-border py-16">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Quick start</p>
              <h2 className="mt-4 font-heading text-3xl font-bold tracking-tight">Run it in minutes</h2>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Everything runs locally with a stubbed Slack — no external accounts needed to try
                it. When you&apos;re ready to connect a real workspace, the step-by-step guide
                covers the Slack app, callback URLs, environment variables, and Linear.
              </p>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                The stack: Next.js 15, Hono, BullMQ + Redis, PostgreSQL, Drizzle ORM, and{" "}
                <span className="text-foreground">@slack/bolt</span>.
              </p>
              <div className="mt-7">
                <TickButton href="/install" primary>
                  Read the installation guide
                </TickButton>
              </div>
            </div>
            <div className="border border-border bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-border" />
                <span className="h-2 w-2 rounded-full bg-border" />
                <span className="h-2 w-2 rounded-full bg-accent/60" />
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground">
                  terminal
                </span>
              </div>
              <div className="overflow-x-auto p-5">
                <pre className="font-mono text-[13px] leading-relaxed text-muted-foreground">
                  <code>{QUICK_START}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Contributing</p>
          <h2 className="mt-4 font-heading text-3xl font-bold tracking-tight">Built in the open</h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Bug reports, feature ideas, docs, and pull requests are all welcome. The roadmap and
            per-phase specs live in the repo, so it&apos;s easy to see what&apos;s planned and
            where help is most useful.
          </p>
          <div className="mt-7 flex flex-wrap gap-4">
            <TickButton href={`${GITHUB_URL}/issues`}>Open an issue</TickButton>
            <TickButton href={`${GITHUB_URL}/pulls`}>Send a pull request</TickButton>
            <TickButton href={`${GITHUB_URL}#roadmap`}>Read the roadmap</TickButton>
          </div>
        </section>
      </main>
    </LandingShell>
  );
}
