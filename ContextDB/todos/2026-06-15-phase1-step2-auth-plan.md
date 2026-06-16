# Phase 1 — Step 2: Slack Manifest + Admin Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An engineering admin can sign in to the poddaily web app with their Slack account (NextAuth v5 Slack OIDC) and reach a protected dashboard; the Slack app is defined by a committed manifest; `smoke:auth` proves the auth flow against a stubbed Slack with no real credentials.

**Architecture:** New `apps/web` (Next.js 15 App Router, Tailwind + shadcn/ui, dark mode). NextAuth v5 with a **stubbable** Slack OIDC provider whose endpoints derive from `SLACK_OIDC_BASE` (default `https://slack.com`, overridden to the local Slack stub in tests). JWT sessions (no DB adapter — "admin = anyone who can Slack-OAuth" per the Phase 1 RBAC default). A minimal Slack OIDC **stub** serves authorize/token/userInfo so the login flow is deterministic and CI-friendly. The full browser login is covered by the live runbook, not the automated smoke (documented scope boundary).

**Tech Stack:** Next.js 15 (App Router, React 19), `next-auth@5` (Auth.js), Tailwind CSS + shadcn/ui, Vitest, the existing pnpm workspace.

Source spec: [phase-1-core-spec.md](../01_specs/phase-1-core-spec.md) (§4 admin auth, §8 admin UI) · Slack integration: [slack-integration.md](../02_architecture/slack-integration.md) · this is build-order step 2 of the [vertical-slice ADR](../03_decisions/2026-06-14-vertical-slice-build.md). Decisions: new Slack app ([ADR](../03_decisions/2026-06-14-new-slack-app.md)), stub+live smoke ([ADR](../03_decisions/2026-06-14-e2e-smoke-with-slack-stub.md)).

> **Framework note for implementers:** NextAuth v5 / Auth.js APIs are version-sensitive. The code below targets `next-auth@5` (beta). If the installed version's import paths or signatures differ, ADAPT them to the installed version while preserving the documented behavior and the task's acceptance criteria — and report the adaptation. Do NOT silently change behavior.

---

## File Structure

```
poddaily/
├─ app_manifest.yaml            # Slack app "poddaily" definition (committed)
├─ apps/
│  └─ web/                      # Next.js 15 admin UI
│     ├─ package.json           # name @poddaily/web
│     ├─ next.config.ts
│     ├─ tailwind/postcss config (from scaffold)
│     ├─ app/
│     │  ├─ layout.tsx          # root layout, dark theme
│     │  ├─ page.tsx            # "/" → redirect to /dashboard (protected) or /login
│     │  ├─ login/page.tsx      # "Sign in with Slack" button
│     │  ├─ (dashboard)/
│     │  │  ├─ layout.tsx       # protected shell (reads session)
│     │  │  └─ dashboard/page.tsx  # placeholder "you're in" page
│     │  └─ api/auth/[...nextauth]/route.ts  # NextAuth handlers
│     ├─ auth.ts                # NextAuth config (stubbable Slack provider) + exports
│     ├─ auth.config.ts         # edge-safe config (providers, pages, authorized callback)
│     ├─ middleware.ts          # route protection via auth
│     ├─ lib/slack-profile.ts   # pure: map Slack OIDC profile → session user
│     ├─ lib/slack-profile.test.ts
│     ├─ components/ui/...       # shadcn components (button, etc.)
│     └─ tests/auth-smoke.test.ts  # smoke:auth assertions
├─ tools/
│  └─ slack-stub/               # minimal stub server (reused by later steps)
│     ├─ package.json           # name @poddaily/slack-stub
│     ├─ src/server.ts          # OIDC authorize/token/userInfo endpoints
│     └─ src/server.test.ts
```

Decomposition: `apps/web` owns the UI + auth wiring; `lib/slack-profile.ts` isolates the one piece of pure auth logic so it's unit-testable without the framework; `tools/slack-stub` is standalone infra reused by Steps 5–6. Each file has one responsibility.

---

### Task 1: Scaffold `apps/web` (Next.js 15) into the monorepo

**Files:**
- Create: `apps/web/*` (via scaffold), adjust `apps/web/package.json` name.

- [ ] **Step 1: Scaffold Next.js into apps/web**

Run from repo root:
```bash
pnpm dlx create-next-app@latest apps/web --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-pnpm --turbopack --disable-git
```
Expected: creates `apps/web` with App Router, Tailwind, TS. (If it prompts despite flags, accept these defaults: TypeScript yes, ESLint yes, Tailwind yes, `src/` no, App Router yes, import alias `@/*`.) If `--disable-git` is unsupported and a nested `apps/web/.git` is created, remove it: `rm -rf apps/web/.git` (the monorepo has a single root git repo).

- [ ] **Step 2: Set the workspace package name**

Edit `apps/web/package.json` — set `"name": "@poddaily/web"` (replace the default `web` name). Leave its scripts (`dev`, `build`, `start`, `lint`) as scaffolded.

- [ ] **Step 3: Install so the workspace links it**

Run: `pnpm install`
Expected: `@poddaily/web` recognized as a workspace package; no errors.

- [ ] **Step 4: Verify the dev server boots and serves**

Run (in background, then curl, then stop):
```bash
pnpm --filter @poddaily/web dev &
sleep 8
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000
kill %1
```
Expected: prints `200`.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(web): scaffold Next.js 15 admin app"
```

---

### Task 2: Login page + protected dashboard placeholder (UI only, unwired)

**Files:**
- Create: `apps/web/app/login/page.tsx`, `apps/web/app/(dashboard)/dashboard/page.tsx`, `apps/web/app/(dashboard)/layout.tsx`
- Modify: `apps/web/app/page.tsx`, `apps/web/app/layout.tsx`
- Add shadcn: `apps/web/components/ui/button.tsx`

- [ ] **Step 1: Initialize shadcn/ui**

Run from `apps/web`:
```bash
cd apps/web && pnpm dlx shadcn@latest init -d && pnpm dlx shadcn@latest add button && cd ..
```
Expected: creates `components/ui/button.tsx`, `lib/utils.ts`, and shadcn config. (`-d` accepts defaults; dark mode is available via the `dark` class.)

- [ ] **Step 2: Set dark theme on the root layout** — `apps/web/app/layout.tsx`

Ensure the `<html>` tag carries the `dark` class and a sensible title. Replace the `<html ...>` opening tag and metadata so the file reads (keep the scaffold's font imports and body class):
```tsx
export const metadata = {
  title: "poddaily",
  description: "Self-hosted Slack standup admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```
If the scaffold added font variables to the body className, preserve them by appending to the className string.

- [ ] **Step 3: Create the login page** — `apps/web/app/login/page.tsx`

```tsx
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
```
Note: the `import("@/auth")` inside the server action keeps `auth.ts` (Node-only) out of any edge bundle. `@/auth` is created in Task 4; until then this page renders but the button action will error if clicked — that's expected until Task 4.

- [ ] **Step 4: Create the protected dashboard** — `apps/web/app/(dashboard)/layout.tsx`

```tsx
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
```

- [ ] **Step 5: Create the dashboard page** — `apps/web/app/(dashboard)/dashboard/page.tsx`

```tsx
export default function DashboardPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">You&apos;re in 🎉</h1>
      <p className="text-muted-foreground">
        Team and standup management arrives in the next build steps.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Redirect "/" to the dashboard** — `apps/web/app/page.tsx`

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 7: Verify pages render (login reachable; build compiles)**

Run:
```bash
pnpm --filter @poddaily/web build
```
Expected: build succeeds. (Auth isn't wired yet, so `/dashboard` will be wired in Task 4; the build must still compile. If the `import("@/auth")` references break the build because `auth.ts` doesn't exist yet, create a temporary stub `apps/web/auth.ts` exporting `export async function auth() { return null; }` and `export async function signIn() {}` — Task 4 replaces it.)

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): login page + protected dashboard placeholder (dark, shadcn)"
```

---

### Task 3: Slack app manifest

**Files:**
- Create: `app_manifest.yaml` (repo root)

- [ ] **Step 1: Create `app_manifest.yaml`**

```yaml
display_information:
  name: poddaily
  description: Self-hosted daily standup bot
  background_color: "#1a1d21"
features:
  bot_user:
    display_name: poddaily
    always_online: true
oauth_config:
  redirect_urls:
    - https://poddaily.example.com/api/slack/oauth/callback
    - https://poddaily.example.com/api/auth/callback/slack
  scopes:
    user:
      - chat:write
      - openid
      - profile
      - email
    bot:
      - chat:write
      - chat:write.customize
      - im:write
      - im:history
      - users:read
      - users:read.email
      - channels:read
      - channels:history
      - groups:read
      - commands
settings:
  event_subscriptions:
    request_url: https://poddaily.example.com/api/slack/events
    bot_events:
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```
Note: `redirect_urls` and `request_url` use a placeholder host; the live runbook ([getting-started](../00_index/getting-started.md)) swaps in the real tunnel/prod host. The admin-login callback path `/api/auth/callback/slack` is NextAuth's default for a provider id of `slack`.

- [ ] **Step 2: Validate it is well-formed YAML**

Run: `pnpm dlx js-yaml app_manifest.yaml > /dev/null && echo "valid yaml"`
Expected: prints `valid yaml` (no parse error).

- [ ] **Step 3: Commit**

```bash
git add app_manifest.yaml
git commit -m "feat(slack): add poddaily app manifest"
```

---

### Task 4: NextAuth v5 with a stubbable Slack provider

**Files:**
- Create: `apps/web/auth.config.ts`, `apps/web/auth.ts`, `apps/web/app/api/auth/[...nextauth]/route.ts`, `apps/web/middleware.ts`, `apps/web/lib/slack-profile.ts`
- Test: `apps/web/lib/slack-profile.test.ts`
- Modify: `.env.example` (add `SLACK_OIDC_BASE`)

- [ ] **Step 1: Install NextAuth v5**

Run: `pnpm --filter @poddaily/web add next-auth@beta`
Expected: `next-auth` (v5) added to `apps/web`.

- [ ] **Step 2: Write the failing test for the profile mapper** — `apps/web/lib/slack-profile.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mapSlackProfile } from "./slack-profile";

describe("mapSlackProfile", () => {
  it("maps a Slack OIDC profile to a session user", () => {
    const user = mapSlackProfile({
      sub: "U123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://img/ada.png",
      "https://slack.com/user_id": "U123",
    });
    expect(user).toEqual({
      id: "U123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: "https://img/ada.png",
    });
  });

  it("falls back to the slack user_id claim when sub is absent", () => {
    const user = mapSlackProfile({
      name: "Grace",
      email: "grace@example.com",
      picture: "https://img/g.png",
      "https://slack.com/user_id": "U999",
    });
    expect(user.id).toBe("U999");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run apps/web/lib/slack-profile.test.ts`
Expected: FAIL — cannot find module `./slack-profile`.

- [ ] **Step 4: Implement the profile mapper** — `apps/web/lib/slack-profile.ts`

```ts
export interface SlackOidcProfile {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  "https://slack.com/user_id"?: string;
  [key: string]: unknown;
}

export interface SessionUser {
  id: string;
  name?: string;
  email?: string;
  image?: string;
}

export function mapSlackProfile(profile: SlackOidcProfile): SessionUser {
  const id = profile.sub ?? profile["https://slack.com/user_id"];
  if (!id) throw new Error("Slack profile missing both sub and user_id");
  return {
    id,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run apps/web/lib/slack-profile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the edge-safe auth config** — `apps/web/auth.config.ts`

```ts
import type { NextAuthConfig } from "next-auth";
// Relative import (not the @/ alias) so this file resolves under both Next and Vitest.
import { mapSlackProfile, type SlackOidcProfile } from "./lib/slack-profile";

const SLACK_BASE = process.env.SLACK_OIDC_BASE ?? "https://slack.com";

export const authConfig = {
  pages: { signIn: "/login" },
  providers: [
    {
      id: "slack",
      name: "Slack",
      type: "oauth",
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      checks: ["pkce", "state"],
      authorization: {
        url: `${SLACK_BASE}/openid/connect/authorize`,
        params: { scope: "openid profile email" },
      },
      token: `${SLACK_BASE}/api/openid.connect.token`,
      userinfo: `${SLACK_BASE}/api/openid.connect.userInfo`,
      profile(profile: SlackOidcProfile) {
        return mapSlackProfile(profile);
      },
    },
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user; // protected routes (see middleware matcher) require a session
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 7: Create the main auth entry** — `apps/web/auth.ts`

```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
});
```
If a temporary `auth.ts` stub was created in Task 2 Step 7, this replaces it.

- [ ] **Step 8: Wire the NextAuth route handler** — `apps/web/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 9: Protect routes via middleware** — `apps/web/middleware.ts`

```ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protect everything except login, the auth API, and Next internals/static assets.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 10: Add `SLACK_OIDC_BASE` to `.env.example`**

Add under the Slack section of `.env.example`:
```
# Admin login OIDC base (default https://slack.com; the Slack stub overrides this in tests)
SLACK_OIDC_BASE=https://slack.com
```

- [ ] **Step 11: Verify build compiles and unit test passes**

Run: `pnpm vitest run apps/web/lib/slack-profile.test.ts && pnpm --filter @poddaily/web build`
Expected: test PASS; build succeeds.

- [ ] **Step 12: Commit**

```bash
git add apps/web .env.example
git commit -m "feat(web): NextAuth v5 Slack OIDC login + route protection"
```

---

### Task 5: Slack OIDC stub server

**Files:**
- Create: `tools/slack-stub/package.json`, `tools/slack-stub/src/server.ts`
- Test: `tools/slack-stub/src/server.test.ts`

The stub is a plain Node HTTP server (no framework) so it stays dependency-light and reusable by later steps. It implements the three OIDC endpoints NextAuth's Slack provider calls.

- [ ] **Step 1: Create `tools/slack-stub/package.json`**

```json
{
  "name": "@poddaily/slack-stub",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/server.ts",
  "exports": { ".": "./src/server.ts" }
}
```

- [ ] **Step 2: Write the failing test** — `tools/slack-stub/src/server.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "./server";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("slack oidc stub", () => {
  it("authorize redirects back to redirect_uri with code + state", async () => {
    const redirectUri = "http://localhost:3000/api/auth/callback/slack";
    const url = `${stub.url}/openid/connect/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=xyz&response_type=code&client_id=stub`;
    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain(`${redirectUri}?`);
    expect(location).toContain("code=");
    expect(location).toContain("state=xyz");
  });

  it("token endpoint returns an access_token", async () => {
    const res = await fetch(`${stub.url}/api/openid.connect.token`, { method: "POST" });
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.token_type).toBe("Bearer");
  });

  it("userInfo returns a Slack OIDC profile", async () => {
    const res = await fetch(`${stub.url}/api/openid.connect.userInfo`, {
      headers: { authorization: "Bearer stub" },
    });
    const body = await res.json();
    expect(body.sub).toBeTruthy();
    expect(body["https://slack.com/user_id"]).toBeTruthy();
    expect(body.email).toContain("@");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tools/slack-stub/src/server.test.ts`
Expected: FAIL — cannot find module `./server`.

- [ ] **Step 4: Implement the stub** — `tools/slack-stub/src/server.ts`

```ts
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface SlackStub {
  url: string;
  close: () => Promise<void>;
}

const STUB_USER = {
  sub: "U_ADMIN_STUB",
  "https://slack.com/user_id": "U_ADMIN_STUB",
  name: "Stub Admin",
  email: "admin@stub.local",
  picture: "https://stub.local/avatar.png",
};

export function startSlackStub(port = 4010): Promise<SlackStub> {
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");

    if (u.pathname === "/openid/connect/authorize") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const location = `${redirectUri}?code=STUB_CODE&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      return res.end();
    }

    if (u.pathname === "/api/openid.connect.token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({
        ok: true,
        access_token: "STUB_ACCESS_TOKEN",
        token_type: "Bearer",
        id_token: "stub.id.token",
      }));
    }

    if (u.pathname === "/api/openid.connect.userInfo") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, ...STUB_USER }));
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tools/slack-stub/src/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Register the workspace package**

Run: `pnpm install`
Expected: `@poddaily/slack-stub` recognized; no errors.

- [ ] **Step 7: Commit**

```bash
git add tools/slack-stub pnpm-lock.yaml
git commit -m "feat(slack-stub): OIDC authorize/token/userInfo stub"
```

---

### Task 6: `smoke:auth` end-to-end check

**Files:**
- Create: `apps/web/tests/auth-smoke.test.ts`
- Modify: root `package.json` (add `smoke:auth` script)

This is build-step 2's smoke scenario from [testing-and-local-dev.md](../02_architecture/testing-and-local-dev.md#per-phase-smoke-scenarios-phase-1-core): the admin auth path works against the stub. It asserts (a) the middleware redirects unauthenticated requests to `/login`, and (b) the auth provider exchanges a stub Slack identity into a mapped session user. The full browser OAuth dance is covered by the live runbook (documented boundary — see note in Step 4).

- [ ] **Step 1: Write the smoke test** — `apps/web/tests/auth-smoke.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startSlackStub, type SlackStub } from "../../../tools/slack-stub/src/server";
import { mapSlackProfile } from "../lib/slack-profile";

let stub: SlackStub;
beforeAll(async () => { stub = await startSlackStub(0); });
afterAll(async () => { await stub.close(); });

describe("smoke:auth", () => {
  it("stub serves a Slack identity that maps to a session user", async () => {
    // Simulate the token + userInfo exchange NextAuth performs against SLACK_OIDC_BASE.
    const tokenRes = await fetch(`${stub.url}/api/openid.connect.token`, { method: "POST" });
    expect((await tokenRes.json()).access_token).toBeTruthy();

    const infoRes = await fetch(`${stub.url}/api/openid.connect.userInfo`, {
      headers: { authorization: "Bearer STUB_ACCESS_TOKEN" },
    });
    const profile = await infoRes.json();
    const user = mapSlackProfile(profile);
    expect(user.id).toBe("U_ADMIN_STUB");
    expect(user.email).toContain("@");
  });

  it("middleware redirects an unauthenticated request to /login", async () => {
    // The middleware is built from authConfig with the `authorized` callback returning false
    // for sessionless requests; NextAuth turns that into a redirect to pages.signIn (/login).
    const { authConfig } = await import("../auth.config");
    const result = authConfig.callbacks!.authorized!({
      auth: null,
      request: new Request("http://localhost:3000/dashboard"),
    } as never);
    expect(result).toBe(false);
  });
});
```
Note: testing the real Next.js middleware HTTP redirect headlessly requires booting the app; that is the live runbook's job. This smoke asserts the decision logic (`authorized` returns false without a session → NextAuth redirects to `/login`) plus the stub→profile exchange, which together cover the deterministic core. If the installed NextAuth types make the `authorized` callback shape differ, adapt the call to match while still asserting "no session ⇒ not authorized".

- [ ] **Step 2: Run the smoke test to verify it passes**

Run: `pnpm vitest run apps/web/tests/auth-smoke.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Add the `smoke:auth` script to root `package.json`**

In root `package.json` scripts, add:
```json
"smoke:auth": "vitest run apps/web/tests/auth-smoke.test.ts tools/slack-stub/src/server.test.ts"
```

- [ ] **Step 4: Run via the script**

Run: `pnpm smoke:auth`
Expected: all tests pass (stub server tests + auth smoke).

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/auth-smoke.test.ts package.json
git commit -m "test(web): smoke:auth — stubbed Slack identity + route-protection logic"
```

---

### Task 7: Definition-of-done updates (docs/context)

Per the per-phase [Definition of Done](../02_architecture/testing-and-local-dev.md#definition-of-done-per-phase): tick the README feature item, keep getting-started accurate, log the build.

**Files:**
- Modify: `README.md` (tick "Slack OAuth admin login"; update Quick start to mention `pnpm --filter @poddaily/web dev` and `smoke:auth`)
- Modify: `ContextDB/00_index/getting-started.md` (confirm the Slack app + admin-login callback URL match the manifest)
- Create: `ContextDB/08_logs/2026-06-15-step2-auth-build.md`

- [ ] **Step 1: Tick the README feature checklist**

In `README.md`, change `- [ ] Slack OAuth admin login` to `- [x] Slack OAuth admin login`.

- [ ] **Step 2: Update the README "Current state" note**

Replace the Foundation "Current state" note's mention that `pnpm dev` is unavailable with: the web app now runs via `pnpm --filter @poddaily/web dev` (admin login at `/login`), and `pnpm smoke:auth` is runnable; the full multi-service `pnpm dev` / `smoke:phase1` still arrive in later steps.

- [ ] **Step 3: Verify getting-started matches the manifest**

In `ContextDB/00_index/getting-started.md` §B2, confirm the admin-login redirect URL is `/api/auth/callback/slack` and the reporter URL is `/api/slack/oauth/callback` — these now match `app_manifest.yaml`. Fix any mismatch.

- [ ] **Step 4: Write the build log** — `ContextDB/08_logs/2026-06-15-step2-auth-build.md`

```markdown
# 2026-06-15 — Step 2 Build: Slack Manifest + Admin Auth

Added `apps/web` (Next.js 15, Tailwind + shadcn, dark) with a `/login` page and a protected
`(dashboard)`. Wired NextAuth v5 with a stubbable Slack OIDC provider (`SLACK_OIDC_BASE`),
JWT sessions, and route-protection middleware. Added `app_manifest.yaml` and a
`tools/slack-stub` OIDC stub. `smoke:auth` green (stub exchange + route-protection logic).

## Verification
- `pnpm test` green (incl. slack-profile + stub unit tests).
- `pnpm smoke:auth` green.
- `pnpm --filter @poddaily/web build` succeeds.

## Scope boundary
Automated `smoke:auth` covers the deterministic core (stub identity → mapped session user;
no-session ⇒ not authorized). The full browser OAuth redirect dance is validated by the
live runbook against a real Slack dev workspace, not in CI.

Next: build-order step 3 — team create + add member (captures TZ) (`smoke:team`).
```

- [ ] **Step 5: Commit**

```bash
git add README.md ContextDB/00_index/getting-started.md ContextDB/08_logs/2026-06-15-step2-auth-build.md
git commit -m "docs: step 2 build log + README/getting-started updates"
```

---

## Verification (end of Step 2)

- [ ] `pnpm test` passes (shared, db, slack-profile, slack-stub).
- [ ] `pnpm smoke:auth` passes.
- [ ] `pnpm --filter @poddaily/web build` succeeds; `pnpm --filter @poddaily/web dev` serves `/login` (200) and `/dashboard` redirects to `/login` when signed out.
- [ ] `app_manifest.yaml` is valid YAML with the documented scopes/events.

This produces working, testable software: a Next.js admin app where an admin signs in with
Slack (validated against a stub in CI, real Slack in the live runbook) and reaches a
protected dashboard — the base for Step 3 (team + member management).
```
