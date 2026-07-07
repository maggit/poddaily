"use client";

import { useEffect, useState } from "react";

const GITHUB_URL = "https://github.com/maggit/poddaily";
const THEME_KEY = "pd-landing-theme";

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

/* Blueprint-style CTA with corner registration marks (Hex-inspired). */
function TickButton({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <span className="group relative inline-block">
      {(["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"] as const).map((pos) => (
        <span
          key={pos}
          aria-hidden
          className={`absolute ${pos} h-2 w-2 border-accent/70 transition-opacity ${
            pos.includes("top") ? "border-t" : "border-b"
          } ${pos.includes("left") ? "border-l" : "border-r"} ${
            primary ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      ))}
      <a
        href={href}
        className={`inline-flex h-11 items-center px-5 text-sm font-medium tracking-tight transition-colors ${
          primary
            ? "border border-accent/60 bg-accent/10 text-foreground hover:bg-accent hover:text-accent-foreground"
            : "border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
        }`}
      >
        {children}
      </a>
    </span>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-9 w-9 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
    >
      {dark ? (
        /* sun */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        /* moon */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

export function Landing() {
  const [dark, setDark] = useState(true);

  // Sync with the pre-hydration script below (?theme= override, else stored, else system).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("theme");
    const stored = q === "light" || q === "dark" ? q : localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") setDark(stored === "dark");
    else setDark(!window.matchMedia("(prefers-color-scheme: light)").matches);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  };

  return (
    <div
      id="pd-landing"
      suppressHydrationWarning
      className={`landing ${dark ? "dark" : ""} min-h-screen bg-background text-foreground antialiased transition-colors`}
    >
      {/* Apply the saved/system theme before first paint to avoid a flash. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q==="light"||q==="dark"?q:localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var e=document.getElementById("pd-landing");if(e){e.classList.toggle("dark",t==="dark")}}catch(_){}})();`,
        }}
      />

      <div className="landing-grain relative overflow-hidden">
        {/* blueprint grid + turquoise glow */}
        <div aria-hidden className="landing-grid-bg pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-220px] h-[560px] w-[820px] -translate-x-1/2 rounded-full blur-[150px]"
          style={{ background: "var(--landing-glow)" }}
        />

        <div className="relative mx-auto max-w-5xl px-6">
          <header className="reveal flex items-center justify-between py-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center border border-accent/60 bg-accent/10 font-heading text-sm font-bold text-accent">
                p
              </span>
              <span className="font-heading text-lg font-bold tracking-tight">poddaily</span>
            </div>
            <nav className="flex items-center gap-2.5">
              <a
                href="#quick-start"
                className="hidden px-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                Quick start
              </a>
              <a
                href={GITHUB_URL}
                className="px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                GitHub
              </a>
              <ThemeToggle dark={dark} onToggle={toggle} />
            </nav>
          </header>

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
                  <TickButton href="#quick-start">Quick start</TickButton>
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
                    it. Deployment guides for Docker and Dokploy live in the repo, alongside the Slack
                    app manifest for connecting a real workspace.
                  </p>
                  <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    The stack: Next.js 15, Hono, BullMQ + Redis, PostgreSQL, Drizzle ORM, and{" "}
                    <span className="text-foreground">@slack/bolt</span>.
                  </p>
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

          <footer className="space-y-2 border-t border-border py-8 font-mono text-[11px] text-subtle-foreground">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>
                poddaily — an open-source standup bot ·{" "}
                <a href={GITHUB_URL} className="underline underline-offset-2 transition-colors hover:text-foreground">
                  source on GitHub
                </a>{" "}
                ·{" "}
                <a
                  href={`${GITHUB_URL}/blob/main/LICENSE`}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  MIT license
                </a>
              </p>
              <p>
                Made with <span className="text-accent">♥</span> by Raquel Hernandez
              </p>
            </div>
            <p>this deployment is a private instance for internal team use</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
