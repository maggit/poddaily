"use client";

import { GITHUB_URL, LandingShell, TickButton } from "@/components/landing/shell";

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{children}</p>;
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border py-12">
      <div className="grid gap-6 md:grid-cols-[140px_1fr]">
        <span className="font-mono text-sm text-subtle-foreground">{n}</span>
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-bold tracking-tight">{title}</h2>
          <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Term({ title, code }: { title: string; code: string }) {
  return (
    <div className="border border-border bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-border" />
        <span className="h-2 w-2 rounded-full bg-border" />
        <span className="h-2 w-2 rounded-full bg-accent/60" />
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground">{title}</span>
      </div>
      <div className="overflow-x-auto p-5">
        <pre className="font-mono text-[13px] leading-relaxed text-muted-foreground">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="border border-border bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">{children}</code>;
}

const ENV_VARS: Array<[name: string, services: string, purpose: string]> = [
  ["DATABASE_URL", "web · api · worker", "Postgres connection (Supabase pooled, port 6543, or your own)"],
  ["DIRECT_URL", "migrations", "Direct Postgres connection (port 5432) — used by drizzle migrations"],
  ["REDIS_URL", "api · worker · web", "BullMQ broker (web uses it for same-day catch-up jobs)"],
  ["SLACK_BOT_TOKEN", "api · worker · web", "Bot User OAuth Token (xoxb-…) from OAuth & Permissions"],
  ["SLACK_SIGNING_SECRET", "api", "Verifies inbound Slack requests — Basic Information → App Credentials"],
  ["SLACK_CLIENT_ID / SLACK_CLIENT_SECRET", "web · api", "OAuth app credentials — Basic Information → App Credentials"],
  ["AUTH_SECRET / NEXTAUTH_SECRET", "web", "Session encryption — generate with: openssl rand -base64 32"],
  ["NEXTAUTH_URL", "web · api · worker", "Public URL of the web app (also builds the connect links in DMs)"],
  ["INTERNAL_API_SECRET", "web · api · worker", "Internal service auth + encryption key for stored user tokens"],
  ["STANDUP_TIMEOUT_MS", "api · worker (same value!)", "Optional — inactivity timeout, default 14400000 (4 h)"],
];

export function InstallGuide() {
  return (
    <LandingShell
      nav={[
        { href: "/", label: "Home" },
        { href: GITHUB_URL, label: "GitHub" },
      ]}
    >
      <main>
        <section className="py-16 md:py-20">
          <Kicker>Installation guide</Kicker>
          <h1 className="reveal landing-hero-text mt-5 max-w-3xl font-heading text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
            From zero to your first standup.
          </h1>
          <p className="reveal mt-6 max-w-2xl text-[15px] leading-relaxed text-muted-foreground" style={{ animationDelay: "120ms" }}>
            Everything poddaily needs: a Postgres database, Redis, the three app services, a Slack
            app in your workspace, and (optionally) a Linear webhook. Budget ~30 minutes. If you
            just want to poke around locally with a stubbed Slack, the{" "}
            <a href={`${GITHUB_URL}#quick-start`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              README quick start
            </a>{" "}
            needs no external accounts at all.
          </p>
        </section>

        <Step n="Step 01" title="Get the code">
          <p>
            You&apos;ll need <span className="text-foreground">Node 22+</span>,{" "}
            <span className="text-foreground">pnpm 10</span> (<Code>corepack enable</Code>), and{" "}
            <span className="text-foreground">Docker</span>.
          </p>
          <Term
            title="terminal"
            code={`git clone ${GITHUB_URL}.git
cd poddaily && pnpm install`}
          />
        </Step>

        <Step n="Step 02" title="Provision the database">
          <p>
            Any Postgres 16 works. With <span className="text-foreground">Supabase</span>: create a
            project, then under <span className="text-foreground">Project Settings → Database</span>{" "}
            grab both connection strings — the <span className="text-foreground">transaction pooler</span>{" "}
            (port 6543) becomes <Code>DATABASE_URL</Code> and the{" "}
            <span className="text-foreground">direct connection</span> (port 5432) becomes{" "}
            <Code>DIRECT_URL</Code>. Then run the migrations:
          </p>
          <Term
            title="terminal"
            code={`DIRECT_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \\
  pnpm db:migrate`}
          />
        </Step>

        <Step n="Step 03" title="Create the Slack app">
          <p>
            Go to <span className="text-foreground">api.slack.com/apps → Create New App → From an app manifest</span>,
            pick your workspace, and paste the repo&apos;s{" "}
            <a href={`${GITHUB_URL}/blob/main/app_manifest.yaml`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              app_manifest.yaml
            </a>{" "}
            — first replacing every <Code>poddaily.example.com</Code> with your real domains (see
            Step 04). The manifest pre-configures all scopes: bot scopes like{" "}
            <Code>chat:write</Code>, <Code>chat:write.customize</Code>, <Code>im:write</Code>,{" "}
            <Code>im:history</Code>, <Code>users:read</Code>, <Code>users:read.email</Code>, and the{" "}
            <Code>chat:write</Code> <em>user</em> scope that lets members post as themselves.
          </p>
          <p>
            Click <span className="text-foreground">Install to Workspace</span>, approve, then collect
            four credentials: the <span className="text-foreground">Bot User OAuth Token</span>{" "}
            (<Code>xoxb-…</Code>, under OAuth &amp; Permissions) and the{" "}
            <span className="text-foreground">Signing Secret, Client ID, and Client Secret</span>{" "}
            (under Basic Information → App Credentials).
          </p>
        </Step>

        <Step n="Step 04" title="Configure the callback URLs">
          <p>
            poddaily runs two public services: the <span className="text-foreground">web</span> app
            (admin UI, e.g. <Code>https://poddaily.example.com</Code>) and the{" "}
            <span className="text-foreground">api</span> service (Slack events, e.g.{" "}
            <Code>https://api.poddaily.example.com</Code>). Point Slack at them:
          </p>
          <ul className="list-none space-y-2">
            <li className="border border-border bg-card/60 px-4 py-3">
              <span className="font-mono text-[12px] text-accent">OAuth &amp; Permissions → Redirect URLs</span>
              <p className="mt-1 font-mono text-[12px]">
                https://&lt;web-domain&gt;/api/auth/callback/slack — admin sign-in
                <br />
                https://&lt;web-domain&gt;/api/slack/oauth/callback — “post as yourself” connect
              </p>
            </li>
            <li className="border border-border bg-card/60 px-4 py-3">
              <span className="font-mono text-[12px] text-accent">Event Subscriptions → Request URL</span>
              <p className="mt-1 font-mono text-[12px]">
                https://&lt;api-domain&gt;/slack/events — must show “Verified”; subscribe to the{" "}
                message.im bot event
              </p>
            </li>
            <li className="border border-border bg-card/60 px-4 py-3">
              <span className="font-mono text-[12px] text-accent">Slash Commands → /standup</span>
              <p className="mt-1 font-mono text-[12px]">https://&lt;api-domain&gt;/slack/events</p>
            </li>
          </ul>
          <p>
            For local development against real Slack, expose the api with a tunnel
            (<Code>ngrok http 3001</Code>) and use the tunnel host in these URLs.
          </p>
        </Step>

        <Step n="Step 05" title="Set the environment variables">
          <p>
            Copy <Code>.env.example</Code> to <Code>.env.local</Code> (local) or set these in your
            deploy platform&apos;s environment panel. Which service needs what:
          </p>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.15em] text-subtle-foreground">
                  <th className="px-4 py-2.5 font-medium">Variable</th>
                  <th className="px-4 py-2.5 font-medium">Needed by</th>
                  <th className="px-4 py-2.5 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ENV_VARS.map(([name, services, purpose]) => (
                  <tr key={name} className="align-top">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-foreground">{name}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-accent">{services}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Leave <Code>SLACK_API_BASE_URL</Code> <em>unset</em> in production — it exists only to
            point the app at the bundled Slack stub during local development and tests.
          </p>
        </Step>

        <Step n="Step 06" title="Deploy the services">
          <p>
            The repo ships Dockerfiles for all three services plus a production compose file,{" "}
            <Code>docker-compose.dokploy.yml</Code>: <span className="text-foreground">web</span>{" "}
            (Next.js, port 3000), <span className="text-foreground">api</span> (Slack events, port
            3001), <span className="text-foreground">worker</span> (scheduler + DMs, no domain), and{" "}
            <span className="text-foreground">redis</span>. Map your web domain to{" "}
            <Code>web:3000</Code> and your api domain to <Code>api:3001</Code>; Postgres stays
            external. Step-by-step runbooks for{" "}
            <a href={`${GITHUB_URL}/blob/main/ContextDB/02_architecture/deployment-dokploy.md`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              Dokploy
            </a>{" "}
            and{" "}
            <a href={`${GITHUB_URL}/blob/main/ContextDB/02_architecture/deployment-railway.md`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              Railway
            </a>{" "}
            live in the repo.
          </p>
        </Step>

        <Step n="Step 07" title="First sign-in & first standup">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Open <Code>https://&lt;web-domain&gt;/team</Code> and sign in with Slack —{" "}
              <span className="text-foreground">the first person to sign in on a fresh install
              becomes the admin</span>; everyone after that starts as a viewer.
            </li>
            <li>
              Invite the bot to each team&apos;s broadcast channel: <Code>/invite @poddaily</Code>{" "}
              (without this, channel posts fail with <Code>not_in_channel</Code>).
            </li>
            <li>
              Create a team, add members (their timezone is captured automatically), and configure
              the standup: questions, schedule, intro/outro, reminder interval.
            </li>
            <li>
              Members get their first DM at the next scheduled tick — or immediately via{" "}
              <Code>/standup start</Code>.
            </li>
          </ul>
        </Step>

        <Step n="Step 08" title="Connect Linear (optional)">
          <p>
            The Linear integration surfaces each member&apos;s closed issues alongside their
            check-ins in the reports dashboard. People are matched by email — the Linear
            assignee&apos;s email must equal the member&apos;s Slack email.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              In Linear: <span className="text-foreground">Settings → API → Webhooks → New webhook</span>.
              Set the URL to <Code>https://&lt;web-domain&gt;/api/integrations/linear/webhook</Code>{" "}
              and subscribe to <span className="text-foreground">Issue</span> events. Copy the{" "}
              <span className="text-foreground">signing secret</span> Linear generates.
            </li>
            <li>
              In poddaily: open <span className="text-foreground">Integrations</span> in the admin
              sidebar and paste the signing secret. Verification is mandatory — events without a
              valid signature are rejected, and multiple secrets are supported if several Linear
              workspaces point at the same instance.
            </li>
            <li>
              The Integrations page shows a last-event health indicator, and an{" "}
              <span className="text-foreground">unmatched people</span> view lists Linear assignees
              whose email didn&apos;t match any member.
            </li>
          </ul>
        </Step>

        <section className="border-t border-border py-14">
          <Kicker>Stuck?</Kicker>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The{" "}
            <a href={`${GITHUB_URL}/blob/main/ContextDB/00_index/getting-started.md`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              full getting-started runbook
            </a>{" "}
            covers troubleshooting (tunnel setup, event-URL verification, timeout tuning), or open
            an issue and we&apos;ll help.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <TickButton href={`${GITHUB_URL}/issues`} primary>
              Open an issue
            </TickButton>
            <TickButton href="/">Back to the landing page</TickButton>
          </div>
        </section>
      </main>
    </LandingShell>
  );
}
