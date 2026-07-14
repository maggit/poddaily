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

const ENV_VARS: Array<[name: string, required: string, purpose: string]> = [
  ["POSTGRES_PASSWORD", "required", "Password for the bundled Postgres (the compose file bakes it into DATABASE_URL)"],
  ["AUTH_SECRET", "required", "Session encryption — generate with: openssl rand -base64 32"],
  ["NEXTAUTH_URL", "required", "Public URL of the web app (auth callbacks + the connect links in DMs)"],
  ["INTERNAL_API_SECRET", "required", "Internal service auth + encryption key for stored user tokens — openssl rand -hex 32"],
  ["SLACK_BOT_TOKEN", "required", "Bot User OAuth Token (xoxb-…) from OAuth & Permissions"],
  ["SLACK_SIGNING_SECRET", "required", "Verifies inbound Slack requests — Basic Information → App Credentials"],
  ["SLACK_CLIENT_ID / SLACK_CLIENT_SECRET", "required", "OAuth app credentials — Basic Information → App Credentials"],
  ["PODDAILY_TAG", "optional", "Image tag to run: latest (default), a major like 1, or an exact 1.0.0"],
  ["PODDAILY_INSTANCE_NAME", "optional", "Your company/instance name — shown in the landing page's instance banner and “Sign in to …” link"],
  ["STANDUP_TIMEOUT_MS", "optional", "Inactivity timeout in ms, default 14400000 (4 h)"],
  ["DIRECT_URL", "optional", "Only for an external transaction-pooled Postgres (e.g. Supabase, port 6543) — migrations need a direct session"],
];

export function InstallGuide({
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
            poddaily ships as one prebuilt Docker image —{" "}
            <Code>ghcr.io/maggit/poddaily</Code> (amd64 + arm64) — and a compose file that bundles
            Postgres and Redis. No cloning, no building: a Slack app, a <Code>.env</Code>, and{" "}
            <Code>docker compose up</Code>. Budget ~20 minutes. If you just want to poke around
            locally with a stubbed Slack, the{" "}
            <a href={`${GITHUB_URL}#quick-start`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              README quick start
            </a>{" "}
            needs no external accounts at all.
          </p>
        </section>

        <Step n="Step 01" title="Grab the compose file">
          <p>
            You&apos;ll need <span className="text-foreground">Docker Engine 24+</span> with the
            compose plugin, and <span className="text-foreground">two public HTTPS hostnames</span>{" "}
            behind your reverse proxy — one for the admin UI, one for the endpoint Slack calls.
            Postgres and Redis are part of the stack; there is nothing else to provision.
          </p>
          <Term
            title="terminal"
            code={`mkdir poddaily && cd poddaily
curl -fsSLO https://raw.githubusercontent.com/maggit/poddaily/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/maggit/poddaily/main/deploy/.env.example`}
          />
          <p>
            Already have Postgres (e.g. Supabase)? Point <Code>DATABASE_URL</Code> in the compose
            file at it, drop its <Code>postgres</Code> service, and set <Code>DIRECT_URL</Code> —
            details in{" "}
            <a href={`${GITHUB_URL}/blob/main/SELF_HOSTING.md`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              SELF_HOSTING.md
            </a>
            .
          </p>
        </Step>

        <Step n="Step 02" title="Create the Slack app">
          <p>
            Go to <span className="text-foreground">api.slack.com/apps → Create New App → From an app manifest</span>,
            pick your workspace, and paste the repo&apos;s{" "}
            <a href={`${GITHUB_URL}/blob/main/app_manifest.yaml`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              app_manifest.yaml
            </a>{" "}
            — first replacing every <Code>poddaily.example.com</Code> with your real domains (see
            Step 03). The manifest pre-configures all scopes: bot scopes like{" "}
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

        <Step n="Step 03" title="Configure the callback URLs">
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

        <Step n="Step 04" title="Fill in .env">
          <p>
            Edit the <Code>.env</Code> you downloaded in Step 01 (or set the same keys in your
            deploy platform&apos;s environment panel). The compose file wires each value to the
            right services:
          </p>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.15em] text-subtle-foreground">
                  <th className="px-4 py-2.5 font-medium">Variable</th>
                  <th className="px-4 py-2.5 font-medium">Required</th>
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

        <Step n="Step 05" title="Start the stack">
          <p>
            One command pulls the published image and starts everything —{" "}
            <span className="text-foreground">web</span> (admin UI, port 3000),{" "}
            <span className="text-foreground">api</span> (Slack events, port 3001),{" "}
            <span className="text-foreground">worker</span> (scheduler + DMs),{" "}
            <span className="text-foreground">postgres</span>, and{" "}
            <span className="text-foreground">redis</span>. Database migrations run automatically
            on every start; there is no separate migration step, now or on upgrades.
          </p>
          <Term
            title="terminal"
            code={`docker compose up -d

curl -s http://localhost:3000/api/health
# {"status":"ok","version":"1.0.0","checks":{"database":"ok","redis":"ok"}}`}
          />
          <p>
            Map your web domain to port <Code>3000</Code> and your api domain to port{" "}
            <Code>3001</Code> in your reverse proxy. Upgrading later is{" "}
            <Code>docker compose pull &amp;&amp; docker compose up -d</Code> — pin{" "}
            <Code>PODDAILY_TAG=1</Code> to follow the v1 major. Deploying on{" "}
            <span className="text-foreground">Dokploy</span>? The same compose file works as a
            Compose service — steps in{" "}
            <a href={`${GITHUB_URL}/blob/main/SELF_HOSTING.md`} className="text-accent underline underline-offset-2 hover:text-accent-strong">
              SELF_HOSTING.md
            </a>
            .
          </p>
        </Step>

        <Step n="Step 06" title="First sign-in & first standup">
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

        <Step n="Step 07" title="Connect Linear (optional)">
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
