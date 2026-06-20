# Step 6b — Reporter User-OAuth (Post-as-User) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members complete a one-time user-OAuth granting poddaily a `chat:write` **user token**; connected members' standup reports are then posted to the channel **as the actual user** (Slack counts them as user messages — no "APP" badge), while unconnected members fall back to the bot post (6a) plus a "Connect to post as yourself" nudge.

**Architecture:** A pure AES-GCM token cipher in `@poddaily/shared`; an encrypted token store in `@poddaily/db`. Two new `apps/web` route handlers (`/api/slack/install` → Slack consent → `/api/slack/oauth/callback`) acquire + store the user token. The api's `broadcastReport` decrypts the member's token and posts the threaded report with a per-user ephemeral `createSlackClient({ token })` (true authorship), falling back to the bot path + nudge when there's no token or the token is invalid. The worker's `sendDm` shows a Connect button to unconnected members (existence check only — it never holds the decryption key).

**Tech Stack:** `node:crypto` (AES-256-GCM, scrypt, HMAC), Drizzle (`@poddaily/db`), Next.js 15 route handlers (`apps/web`), `@slack/web-api` via `@poddaily/slack-client`, BullMQ worker, `@slack/bolt` api, Vitest, the `tools/slack-stub` recorder.

Source: [Step 6b design spec](../specs/2026-06-20-step6b-reporter-user-oauth-design.md) · [post-as-user ADR](../../../ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md) · [slack-integration §Reporter user-OAuth](../../../ContextDB/02_architecture/slack-integration.md#2-reporter-user-oauth-post-as-user).

> **Scope notes (documented, not gaps):**
> 1. **Only the user-token path satisfies the analytics requirement.** `chat:write.customize` (6a) is bot-authored ("APP" badge, counts as bot). The smoke asserts *which token* authenticated the post.
> 2. **Fallback = degraded + nudge:** unconnected (or revoked-token) members still get the bot post, with a Connect nudge appended.
> 3. **Worker never decrypts.** `sendDm` uses `hasUserToken` (existence). Only **web** (encrypt) and **api** (decrypt) use `INTERNAL_API_SECRET`.
> 4. **OAuth `state` is HMAC-signed + freshness-checked** (stateless CSRF mitigation — no server-side nonce store; acceptable for Phase 1).
> 5. **Opening message + counter stay bot-posted** (system messages).
> 6. **`INTERNAL_API_SECRET` must now be set on the `api` service** (new requirement) in addition to web/worker.

---

## File Structure

```
packages/shared/src/crypto.ts (+ test)             # encryptToken / decryptToken (pure AES-GCM)
packages/shared/src/index.ts                        # re-export ./crypto
packages/db/src/tokens.ts (+ test)                  # saveUserToken / getUserToken / hasUserToken
packages/db/src/index.ts                            # re-export ./tokens
apps/web/lib/oauth-state.ts (+ test)                # signState / verifyState (HMAC)
tools/slack-stub/src/server.ts (+ test)             # oauth/v2/authorize + oauth.v2.access; record Bearer token
apps/web/app/api/slack/install/route.ts             # GET → redirect to Slack authorize
apps/web/app/api/slack/oauth/callback/route.ts (+ test)  # GET → exchange + store + success page
apps/worker/src/sendDm.ts (+ test)                  # Connect button when !hasUserToken
apps/api/src/handleMessage.ts (+ test)              # broadcast as user / degraded + nudge
apps/api/src/index.ts                               # wire secret + makeUserSlack into handleMessage deps
apps/api/tests/standup-smoke.test.ts                # connected (user token) + unconnected (degraded) assertions
README.md · ContextDB/* · ADR · build log           # DoD
```

---

### Task 1: Token crypto in `@poddaily/shared` (TDD)

**Files:**
- Create: `packages/shared/src/crypto.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/crypto.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/crypto.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const SECRET = "test-internal-api-secret-0123456789";

describe("token crypto", () => {
  it("roundtrips a token", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    expect(enc).not.toContain("xoxp-abc-123"); // not plaintext
    expect(decryptToken(enc, SECRET)).toBe("xoxp-abc-123");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptToken("same", SECRET)).not.toBe(encryptToken("same", SECRET));
  });

  it("throws when decrypting with the wrong secret", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    expect(() => decryptToken(enc, "a-different-secret-whichiswrong-99")).toThrow();
  });

  it("throws when the payload is tampered", () => {
    const enc = encryptToken("xoxp-abc-123", SECRET);
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptToken(raw.toString("base64"), SECRET)).toThrow();
  });
});
```

- [ ] **Step 2: Run from repo root, confirm it FAILS** (module not found)

Run: `pnpm exec vitest run packages/shared/src/crypto.test.ts`
Expected: FAIL — "Cannot find module './crypto'".

- [ ] **Step 3: Implement** — `packages/shared/src/crypto.ts`

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const SALT = "poddaily.token.v1"; // fixed app-level salt; the secret is the entropy
const IV_LEN = 12;
const TAG_LEN = 16;

function keyFrom(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

/** Encrypt a token → base64( iv(12) | authTag(16) | ciphertext ). */
export function encryptToken(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Inverse of encryptToken. Throws if the secret is wrong or the payload was tampered. */
export function decryptToken(payload: string, secret: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Re-export** — add to `packages/shared/src/index.ts`:

```ts
export * from "./crypto";
```

- [ ] **Step 5: Run from repo root, confirm PASS** (4 tests)

Run: `pnpm exec vitest run packages/shared/src/crypto.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/crypto.ts packages/shared/src/crypto.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): AES-GCM token encrypt/decrypt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Token store in `@poddaily/db` (integration TDD)

**Files:**
- Create: `packages/db/src/tokens.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tokens.test.ts`

`@poddaily/db` already depends on `@poddaily/shared` (schema.ts imports types from it), so importing the crypto is fine. The `slack_user_tokens` table already exists: `{ slackUserId (pk), accessToken (text), scopes (text), authedAt }`.

- [ ] **Step 1: Write the failing test** — `packages/db/src/tokens.test.ts`

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createDb } from "./client";
import { saveUserToken, getUserToken, hasUserToken } from "./tokens";

const { db, sql } = createDb();
const SECRET = "test-internal-api-secret-0123456789";
const USER = "U_TOK_TEST";

beforeEach(async () => {
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
});
afterAll(async () => {
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
  await sql.end();
});

describe("token store", () => {
  it("saves encrypted (not plaintext) and reads back decrypted", async () => {
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-secret-token", scopes: "chat:write" });
    const [row] = await sql`select access_token from slack_user_tokens where slack_user_id = ${USER}`;
    expect(row.access_token).not.toContain("xoxp-secret-token"); // encrypted at rest
    expect(await getUserToken(db, SECRET, USER)).toBe("xoxp-secret-token");
  });

  it("hasUserToken reflects existence without decrypting", async () => {
    expect(await hasUserToken(db, USER)).toBe(false);
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-x", scopes: "chat:write" });
    expect(await hasUserToken(db, USER)).toBe(true);
  });

  it("re-connect overwrites the token", async () => {
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-old", scopes: "chat:write" });
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-new", scopes: "chat:write" });
    expect(await getUserToken(db, SECRET, USER)).toBe("xoxp-new");
  });

  it("getUserToken returns null for an unknown user", async () => {
    expect(await getUserToken(db, SECRET, "U_NOPE")).toBeNull();
  });
});
```

- [ ] **Step 2: Run from repo root, confirm it FAILS** (module not found). Requires local Postgres.

Run: `pnpm exec vitest run packages/db/src/tokens.test.ts`
Expected: FAIL — "Cannot find module './tokens'".

- [ ] **Step 3: Implement** — `packages/db/src/tokens.ts`

```ts
import { eq } from "drizzle-orm";
import { encryptToken, decryptToken } from "@poddaily/shared";
import * as schema from "./schema";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>["db"];

/** Encrypt + upsert a reporter's user token. Re-connect overwrites. */
export async function saveUserToken(
  db: Db,
  secret: string,
  args: { slackUserId: string; accessToken: string; scopes: string },
): Promise<void> {
  const ciphertext = encryptToken(args.accessToken, secret);
  await db
    .insert(schema.slackUserTokens)
    .values({ slackUserId: args.slackUserId, accessToken: ciphertext, scopes: args.scopes })
    .onConflictDoUpdate({
      target: schema.slackUserTokens.slackUserId,
      set: { accessToken: ciphertext, scopes: args.scopes, authedAt: new Date() },
    });
}

/** Decrypt + return a reporter's user token, or null if not connected. */
export async function getUserToken(db: Db, secret: string, slackUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ token: schema.slackUserTokens.accessToken })
    .from(schema.slackUserTokens)
    .where(eq(schema.slackUserTokens.slackUserId, slackUserId));
  return row ? decryptToken(row.token, secret) : null;
}

/** Whether a reporter has connected — existence only, no decryption (for the worker). */
export async function hasUserToken(db: Db, slackUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.slackUserTokens.slackUserId })
    .from(schema.slackUserTokens)
    .where(eq(schema.slackUserTokens.slackUserId, slackUserId));
  return Boolean(row);
}
```

- [ ] **Step 4: Re-export** — add to `packages/db/src/index.ts`:

```ts
export { saveUserToken, getUserToken, hasUserToken } from "./tokens";
```

- [ ] **Step 5: Run from repo root, confirm PASS** (4 tests)

Run: `pnpm exec vitest run packages/db/src/tokens.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/tokens.ts packages/db/src/tokens.test.ts packages/db/src/index.ts
git commit -m "feat(db): encrypted slack_user_tokens store (save/get/has)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: OAuth state HMAC helper in `apps/web` (TDD)

**Files:**
- Create: `apps/web/lib/oauth-state.ts`
- Test: `apps/web/lib/oauth-state.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/web/lib/oauth-state.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { signState, verifyState } from "./oauth-state";

const SECRET = "test-internal-api-secret-0123456789";

describe("oauth state", () => {
  it("verifies a freshly signed state", () => {
    const now = 1_000_000;
    const s = signState(SECRET, now);
    expect(verifyState(SECRET, s, now + 1000)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const s = signState(SECRET, 1_000_000);
    expect(verifyState(SECRET, s.slice(0, -1) + "0", 1_000_500)).toBe(false);
  });

  it("rejects a state signed with a different secret", () => {
    const s = signState("other-secret-aaaaaaaaaaaaaaaaaaaa", 1_000_000);
    expect(verifyState(SECRET, s, 1_000_500)).toBe(false);
  });

  it("rejects an expired state (> 10 min old)", () => {
    const s = signState(SECRET, 1_000_000);
    expect(verifyState(SECRET, s, 1_000_000 + 11 * 60 * 1000)).toBe(false);
  });

  it("rejects a malformed state", () => {
    expect(verifyState(SECRET, "not.a.valid.state", 1_000_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run from repo root, confirm it FAILS**

Run: `pnpm exec vitest run apps/web/lib/oauth-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/web/lib/oauth-state.ts`

```ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** Sign a one-time state value: `${nonce}.${issuedAt}.${hmac}`. */
export function signState(secret: string, now: number = Date.now()): string {
  const payload = `${randomBytes(16).toString("hex")}.${now}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Verify HMAC + freshness. Stateless CSRF mitigation (no server-side nonce store). */
export function verifyState(secret: string, state: string, now: number = Date.now()): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issued, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${nonce}.${issued}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ts = Number(issued);
  return Number.isFinite(ts) && now >= ts && now - ts <= MAX_AGE_MS;
}
```

- [ ] **Step 4: Run from repo root, confirm PASS** (5 tests)

Run: `pnpm exec vitest run apps/web/lib/oauth-state.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/oauth-state.ts apps/web/lib/oauth-state.test.ts
git commit -m "feat(web): HMAC-signed OAuth state (sign/verify)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Slack stub — OAuth v2 fakes + record the Bearer token

**Files:**
- Modify: `tools/slack-stub/src/server.ts`
- Test: `tools/slack-stub/src/server.test.ts`

- [ ] **Step 1: READ** `tools/slack-stub/src/server.ts` — confirm `RecordedMessage`, the `/api/chat.postMessage` handler (it pushes to `messages` and returns `{ ok, ts }`), `readBody`, `json`, and the existing OIDC routes (`/openid/connect/authorize`, `/api/openid.connect.token`) to mirror their style.

- [ ] **Step 2: Add `token` to `RecordedMessage`** — extend the interface:

```ts
export interface RecordedMessage {
  channel: string;
  text: string;
  thread_ts?: string;
  username?: string;
  icon_url?: string;
  blocks?: string;
  token?: string; // the Bearer token that authenticated the post (bot xoxb- vs user xoxp-)
}
```

- [ ] **Step 3: Record the Bearer token on `chat.postMessage`** — in that handler, read the auth header and include it:

```ts
    if (u.pathname === "/api/chat.postMessage") {
      const authHeader = req.headers["authorization"];
      const auth = (Array.isArray(authHeader) ? authHeader[0] : authHeader) ?? "";
      const body = await readBody(req);
      messages.push({
        channel: body.get("channel") ?? "",
        text: body.get("text") ?? "",
        thread_ts: body.get("thread_ts") ?? undefined,
        username: body.get("username") ?? undefined,
        icon_url: body.get("icon_url") ?? undefined,
        blocks: body.get("blocks") ?? undefined,
        token: auth.replace(/^Bearer\s+/i, "") || undefined,
      });
      return json(200, { ok: true, ts: String(tsCounter++) });
    }
```

- [ ] **Step 4: Add the reporter OAuth v2 fakes** (near the existing OIDC routes):

```ts
    // --- Reporter user-OAuth (post-as-user) ---
    if (u.pathname === "/oauth/v2/authorize") {
      const redirectUri = u.searchParams.get("redirect_uri") ?? "";
      const state = u.searchParams.get("state") ?? "";
      const location = `${redirectUri}?code=STUB_USER_CODE&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { location });
      return res.end();
    }
    if (u.pathname === "/api/oauth.v2.access") {
      await readBody(req); // drain
      return json(200, {
        ok: true,
        authed_user: { id: "U_STUB_USER", access_token: "xoxp-stub-user", scope: "chat:write", token_type: "user" },
      });
    }
```

- [ ] **Step 5: Add a stub test** — append to `tools/slack-stub/src/server.test.ts` (match the file's existing style — shared `stub`/`postForm` or per-test `startSlackStub`):

```ts
it("fakes oauth.v2.access and records the Bearer token on postMessage", async () => {
  const stub = await startSlackStub(0);
  try {
    const access = await (await fetch(`${stub.url}/api/oauth.v2.access`, { method: "POST" })).json();
    expect(access).toMatchObject({ ok: true, authed_user: { id: "U_STUB_USER", access_token: "xoxp-stub-user" } });

    await fetch(`${stub.url}/api/chat.postMessage`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer xoxp-stub-user" },
      body: new URLSearchParams({ channel: "C1", text: "as me" }),
    });
    const [msg] = (await (await fetch(`${stub.url}/__stub/messages`)).json()) as Array<Record<string, string>>;
    expect(msg).toMatchObject({ channel: "C1", token: "xoxp-stub-user" });
  } finally {
    await stub.close();
  }
});
```

- [ ] **Step 6: Run from repo root, confirm PASS**

Run: `pnpm exec vitest run tools/slack-stub/src/server.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 7: Commit**

```bash
git add tools/slack-stub/src/server.ts tools/slack-stub/src/server.test.ts
git commit -m "test(slack-stub): oauth.v2 fakes + record Bearer token on postMessage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Web install route (`GET /api/slack/install`)

**Files:**
- Create: `apps/web/app/api/slack/install/route.ts`
- Test: `apps/web/app/api/slack/install/route.test.ts`

- [ ] **Step 1: READ** an existing `apps/web` route handler (`apps/web/app/api/auth/[...nextauth]/route.ts`) and `apps/web/tsconfig.json` to confirm the import-alias convention (e.g. `@/lib/...` vs relative). Use whichever the repo uses for importing `lib/oauth-state` below.

- [ ] **Step 2: Write the failing test** — `apps/web/app/api/slack/install/route.test.ts`

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { GET } from "./route";

beforeAll(() => {
  process.env.SLACK_OAUTH_BASE = "https://slack.example";
  process.env.SLACK_CLIENT_ID = "CID";
  process.env.NEXTAUTH_URL = "https://web.example";
  process.env.INTERNAL_API_SECRET = "test-internal-api-secret-0123456789";
});

describe("GET /api/slack/install", () => {
  it("redirects to Slack authorize with user_scope + signed state", async () => {
    const res = await GET();
    expect(res.status).toBe(307); // NextResponse.redirect default
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://slack.example/oauth/v2/authorize");
    expect(loc.searchParams.get("user_scope")).toBe("chat:write");
    expect(loc.searchParams.get("client_id")).toBe("CID");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://web.example/api/slack/oauth/callback");
    expect(loc.searchParams.get("state")).toMatch(/\w+\.\d+\.\w+/);
  });
});
```

- [ ] **Step 3: Run from repo root, confirm it FAILS** (no route yet)

Run: `pnpm exec vitest run apps/web/app/api/slack/install/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 4: Implement** — `apps/web/app/api/slack/install/route.ts` (use the alias the repo uses for the `signState` import):

```ts
import { NextResponse } from "next/server";
import { signState } from "@/lib/oauth-state";

export async function GET() {
  const base = process.env.SLACK_OAUTH_BASE ?? "https://slack.com";
  const url = new URL(`${base}/oauth/v2/authorize`);
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("user_scope", "chat:write");
  url.searchParams.set("redirect_uri", `${process.env.NEXTAUTH_URL}/api/slack/oauth/callback`);
  url.searchParams.set("state", signState(process.env.INTERNAL_API_SECRET ?? ""));
  return NextResponse.redirect(url.toString());
}
```

> If `@/lib/oauth-state` does not resolve (no `@` alias), use the correct relative path from this route file: `../../../../lib/oauth-state`. Verify against the test passing.

- [ ] **Step 5: Run from repo root, confirm PASS**

Run: `pnpm exec vitest run apps/web/app/api/slack/install/route.test.ts`
Expected: PASS. (If `res.status` is 308 rather than 307 in this Next version, adjust the assertion to the actual redirect status the framework returns — both are valid redirects.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/slack/install/route.ts apps/web/app/api/slack/install/route.test.ts
git commit -m "feat(web): /api/slack/install redirect to Slack user-OAuth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Web callback route (`GET /api/slack/oauth/callback`)

**Files:**
- Create: `apps/web/app/api/slack/oauth/callback/route.ts`
- Test: `apps/web/app/api/slack/oauth/callback/route.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/web/app/api/slack/oauth/callback/route.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, getUserToken } from "@poddaily/db";
import { signState } from "@/lib/oauth-state";
import { startSlackStub, type SlackStub } from "@poddaily/slack-stub";
import { GET } from "./route";

const { sql, db } = createDb();
const SECRET = "test-internal-api-secret-0123456789";
let stub: SlackStub;

beforeAll(async () => {
  stub = await startSlackStub(0);
  process.env.SLACK_OAUTH_BASE = stub.url;
  process.env.SLACK_CLIENT_ID = "CID";
  process.env.SLACK_CLIENT_SECRET = "CSECRET";
  process.env.NEXTAUTH_URL = "https://web.example";
  process.env.INTERNAL_API_SECRET = SECRET;
  await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
});
afterAll(async () => {
  await stub.close();
  await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
  await sql.end();
});

describe("GET /api/slack/oauth/callback", () => {
  it("exchanges the code and stores the user token, then shows success", async () => {
    const state = signState(SECRET);
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=${state}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Connected");
    expect(await getUserToken(db, SECRET, "U_STUB_USER")).toBe("xoxp-stub-user");
  });

  it("rejects a bad state without storing anything", async () => {
    await sql`delete from slack_user_tokens where slack_user_id = 'U_STUB_USER'`;
    const res = await GET(new Request(`https://web.example/api/slack/oauth/callback?code=STUB_USER_CODE&state=bad.state.sig`));
    expect(res.status).toBe(400);
    expect(await getUserToken(db, SECRET, "U_STUB_USER")).toBeNull();
  });
});
```

- [ ] **Step 2: Run from repo root, confirm it FAILS** (no route). Requires Postgres.

Run: `pnpm exec vitest run apps/web/app/api/slack/oauth/callback/route.test.ts`
Expected: FAIL — cannot find `./route`.

- [ ] **Step 3: Implement** — `apps/web/app/api/slack/oauth/callback/route.ts`

```ts
import { NextResponse } from "next/server";
import { verifyState } from "@/lib/oauth-state";
import { createDb, saveUserToken } from "@poddaily/db";

function page(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">` +
      `<h1>${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const secret = process.env.INTERNAL_API_SECRET ?? "";

  if (!code || !state || !verifyState(secret, state)) {
    return page("Couldn’t connect", "The link expired or was invalid. Please try connecting again from Slack.", 400);
  }

  const base = process.env.SLACK_OAUTH_BASE ?? "https://slack.com";
  const res = await fetch(`${base}/api/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/slack/oauth/callback`,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; authed_user?: { id?: string; access_token?: string; scope?: string } };
  if (!data.ok || !data.authed_user?.id || !data.authed_user.access_token) {
    return page("Couldn’t connect", "Slack did not return a user token. Please try again.", 400);
  }

  const { db } = createDb();
  await saveUserToken(db, secret, {
    slackUserId: data.authed_user.id,
    accessToken: data.authed_user.access_token,
    scopes: data.authed_user.scope ?? "chat:write",
  });
  return page("Connected ✅", "poddaily will now post your standups as you. You can close this tab.", 200);
}
```

- [ ] **Step 4: Run from repo root, confirm PASS** (2 tests)

Run: `pnpm exec vitest run apps/web/app/api/slack/oauth/callback/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/slack/oauth/callback/route.ts apps/web/app/api/slack/oauth/callback/route.test.ts
git commit -m "feat(web): /api/slack/oauth/callback exchanges + stores user token

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Worker `sendDm` shows a Connect button to unconnected members

**Files:**
- Modify: `apps/worker/src/sendDm.ts`
- Test: `apps/worker/src/sendDm.test.ts`

- [ ] **Step 1: Write the failing test** — add to `apps/worker/src/sendDm.test.ts`. READ the file first for the seeded constants + `fakeSlack` recorder (it records posts with channel/text; ensure it also captures the 3rd `opts` arg — if not, extend it to push `{ channel, text, opts }`). Add:

```ts
it("posts a Connect button to a member with no user token", async () => {
  process.env.NEXTAUTH_URL = "https://web.example";
  // (seed a standup + run as the existing tests do; the member has no slack_user_tokens row)
  const slack = fakeSlack();
  await sendDm({ db, slack }, { runId, standupId, slackUserId: USER, slackDisplayName: "Tester" });
  const connect = slack.posts.find((p) => JSON.stringify(p.opts ?? {}).includes("/api/slack/install"));
  expect(connect).toBeTruthy();
});

it("does NOT post a Connect button to a connected member", async () => {
  process.env.NEXTAUTH_URL = "https://web.example";
  await saveUserToken(db, process.env.INTERNAL_API_SECRET ?? "test-secret-aaaaaaaaaaaaaaaaaaaa", { slackUserId: USER, accessToken: "xoxp-x", scopes: "chat:write" });
  const slack = fakeSlack();
  await sendDm({ db, slack }, { runId, standupId, slackUserId: USER, slackDisplayName: "Tester" });
  const connect = slack.posts.find((p) => JSON.stringify(p.opts ?? {}).includes("/api/slack/install"));
  expect(connect).toBeFalsy();
});
```
(Import `saveUserToken` from `@poddaily/db`. Use the file's real seeded `runId`/`standupId`/`USER`. Clean up the `slack_user_tokens` row in the test teardown. The existing sendDm tests don't set `NEXTAUTH_URL`, so they keep posting no button — confirm they still pass.)

- [ ] **Step 2: Run from repo root, confirm the new cases FAIL.**

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`

- [ ] **Step 3: Implement** — in `apps/worker/src/sendDm.ts`:

Update the import:
```ts
import { schema, eq, and, desc, hasUserToken } from "@poddaily/db";
```
After the `q1Ts` post and BEFORE the `db.insert(...)`, add:

```ts
  // Nudge unconnected members to connect so their reports post as themselves (Step 6b).
  // Existence check only — the worker never decrypts tokens.
  const webUrl = process.env.NEXTAUTH_URL;
  if (webUrl && !(await hasUserToken(db, slackUserId))) {
    await slack.postMessage(
      channelId,
      "Want your standups to post as you in the channel? Connect once.",
      {
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "Want your standups to post as *you* in the channel? Connect once:" } },
          { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Connect to post as yourself" }, url: `${webUrl}/api/slack/install` }] },
        ],
      },
    );
  }
```

- [ ] **Step 4: Run from repo root, confirm PASS** (existing + 2 new).

Run: `pnpm exec vitest run apps/worker/src/sendDm.test.ts`

- [ ] **Step 5: Type-check the worker:** `pnpm --filter @poddaily/worker exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/sendDm.ts apps/worker/src/sendDm.test.ts
git commit -m "feat(worker): Connect-button nudge for unconnected members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: api `broadcastReport` posts as the user (or degraded + nudge)

**Files:**
- Modify: `apps/api/src/handleMessage.ts`
- Test: `apps/api/src/handleMessage.test.ts`

- [ ] **Step 1: Write the failing test** — add to `apps/api/src/handleMessage.test.ts`. The existing tests seed a 2-question standup + run + report and set `run.channel_opening_ts`. Add a richer slack capture (records `{channel, text, opts}`) and a `makeUserSlack` recorder. Add:

```ts
const SECRET = "test-internal-api-secret-0123456789";

it("posts the report with the member's user token when connected", async () => {
  await sql`update standup_runs set channel_opening_ts = 'open_ts_b1' where id = ${runId}`;
  await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-user-1", scopes: "chat:write" });

  const userPosts: Array<{ token: string; channel: string; opts: any }> = [];
  const botPosts: Array<{ channel: string; opts: any }> = [];
  const slack = {
    openDm: async () => "D",
    postMessage: async (channel: string, _t: string, opts: any = {}) => { botPosts.push({ channel, opts }); return "bot_ts"; },
    updateMessage: async () => {},
  };
  const makeUserSlack = (token: string) => ({
    openDm: async () => "D",
    postMessage: async (channel: string, _t: string, opts: any = {}) => { userPosts.push({ token, channel, opts }); return "user_ts"; },
    updateMessage: async () => {},
  });

  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a1" });
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a2" });

  // posted via the USER token, threaded, with NO username override (true authorship)
  expect(userPosts).toHaveLength(1);
  expect(userPosts[0].token).toBe("xoxp-user-1");
  expect(userPosts[0].opts.threadTs).toBe("open_ts_b1");
  expect(userPosts[0].opts.username).toBeUndefined();
  const [r] = await sql`select channel_post_ts from standup_reports where slack_user_id = ${USER}`;
  expect(r.channel_post_ts).toBe("user_ts");
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;
});

it("falls back to a bot post with a Connect nudge when not connected", async () => {
  process.env.NEXTAUTH_URL = "https://web.example";
  await sql`update standup_runs set channel_opening_ts = 'open_ts_b2' where id = ${runId}`;
  await sql`delete from slack_user_tokens where slack_user_id = ${USER}`;

  const botPosts: Array<{ opts: any }> = [];
  const slack = {
    openDm: async () => "D",
    postMessage: async (_c: string, _t: string, opts: any = {}) => { botPosts.push({ opts }); return "bot_ts"; },
    updateMessage: async () => {},
  };
  const makeUserSlack = () => { throw new Error("should not be called when unconnected"); };

  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a1" });
  await handleMessage({ db, slack, secret: SECRET, makeUserSlack }, { slackUserId: USER, channel: DM, text: "a2" });

  const reply = botPosts.find((p) => p.opts?.threadTs === "open_ts_b2");
  expect(reply).toBeTruthy();
  expect(reply!.opts.username).toBe("HM Tester"); // bot chat:write.customize attribution
  expect(JSON.stringify(reply!.opts.blocks)).toContain("/api/slack/install"); // nudge present
});
```
(Import `saveUserToken` from `@poddaily/db`. Use the file's real `USER`/`DM`/`runId`/`CHAN` and seeded member name. Existing tests call `handleMessage({ db, slack })` — they will need `secret` + `makeUserSlack` added; update the existing `fakeSlack`-based calls to pass `secret: SECRET` and a `makeUserSlack` that returns the same fake. Default unconnected → bot path, so existing completed-report assertions still hold.)

- [ ] **Step 2: Run from repo root, confirm the new cases FAIL.**

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`

- [ ] **Step 3: Implement** — in `apps/api/src/handleMessage.ts`:

Update imports + deps:
```ts
import { schema, eq, and, desc, getUserToken } from "@poddaily/db";
import { advanceReport, buildOpeningMessage, buildReportBlocks } from "@poddaily/shared";
import type { ReportAnswer } from "@poddaily/shared";
import type { SlackClient } from "@poddaily/slack-client";
import type { createDb } from "@poddaily/db";

type Db = ReturnType<typeof createDb>["db"];

export interface HandleMessageDeps {
  db: Db;
  slack: SlackClient;
  secret: string;                                  // INTERNAL_API_SECRET (decrypt user tokens)
  makeUserSlack: (token: string) => SlackClient;   // build a per-user client for post-as-user
}
```

Update the `broadcastReport` call site (the `complete` case) — it already passes `deps`, so change it to pass the full deps:
```ts
      await broadcastReport(deps, { report, run, standup, answers: action.answers });
```
(`deps` is the `handleMessage` deps object — replace the `{ db, slack }` literal at the broadcast call with `deps`.)

Replace the body of `broadcastReport` so the threaded post uses the user token when present. The signature becomes `broadcastReport(deps: HandleMessageDeps, ctx)`:

```ts
async function broadcastReport(
  deps: HandleMessageDeps,
  ctx: {
    report: typeof schema.standupReports.$inferSelect;
    run: typeof schema.standupRuns.$inferSelect;
    standup: typeof schema.standups.$inferSelect;
    answers: ReportAnswer[];
  },
): Promise<void> {
  const { db, slack, secret, makeUserSlack } = deps;
  const { report, run, standup, answers } = ctx;
  try {
    if (!run.channelOpeningTs) {
      console.warn(`[broadcast] run ${run.id} has no opening ts; skipping report ${report.id}`);
      return;
    }
    if (!standup.teamId) return;

    const [team] = await db
      .select({ channelId: schema.teams.slackChannelId })
      .from(schema.teams)
      .where(eq(schema.teams.id, standup.teamId));
    if (!team?.channelId) return;

    const built = buildReportBlocks({ standupName: standup.name, displayName: report.slackDisplayName, answers });
    const token = await getUserToken(db, secret, report.slackUserId);

    let postTs: string | null = null;
    if (token) {
      // Post AS THE USER — true authorship, no username/icon override. Slack counts it
      // as the user's message (no "APP" badge).
      try {
        postTs = await makeUserSlack(token).postMessage(team.channelId, built.text, {
          threadTs: run.channelOpeningTs,
          blocks: built.blocks,
        });
      } catch (err) {
        console.warn(`[broadcast] user-token post failed for ${report.slackUserId}; degrading:`, (err as Error).message);
      }
    }
    if (!postTs) {
      // Degraded: bot posts with the member's name/avatar + a Connect nudge.
      const [member] = await db
        .select({ avatar: schema.teamMembers.slackAvatarUrl })
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, standup.teamId), eq(schema.teamMembers.slackUserId, report.slackUserId)));
      const webUrl = process.env.NEXTAUTH_URL;
      const blocks = webUrl
        ? [...(built.blocks as unknown[]), {
            type: "context",
            elements: [{ type: "mrkdwn", text: `_${report.slackDisplayName} hasn't connected — <${webUrl}/api/slack/install|Connect to post as yourself>_` }],
          }]
        : built.blocks;
      postTs = await slack.postMessage(team.channelId, built.text, {
        threadTs: run.channelOpeningTs,
        username: report.slackDisplayName,
        iconUrl: member?.avatar ?? undefined,
        blocks,
      });
    }

    await db.update(schema.standupReports).set({ channelPostTs: postTs }).where(eq(schema.standupReports.id, report.id));

    const all = await db
      .select({ status: schema.standupReports.status })
      .from(schema.standupReports)
      .where(eq(schema.standupReports.runId, run.id));
    const opening = buildOpeningMessage({
      standupName: standup.name,
      date: run.scheduledDate,
      reported: all.filter((r) => r.status === "completed").length,
      total: all.length,
    });
    await slack.updateMessage(team.channelId, run.channelOpeningTs, { text: opening.text, blocks: opening.blocks });
  } catch (err) {
    console.warn(`[broadcast] degraded for report ${report.id}:`, (err as Error).message);
  }
}
```

- [ ] **Step 4: Run from repo root, confirm api tests PASS** (existing + 2 new).

Run: `pnpm exec vitest run apps/api/src/handleMessage.test.ts`

- [ ] **Step 5: Type-check:** `pnpm --filter @poddaily/api exec tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handleMessage.ts apps/api/src/handleMessage.test.ts
git commit -m "feat(api): post report as the user via user token; degrade + nudge otherwise

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Wire api boot deps + extend `smoke:standup`

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/tests/standup-smoke.test.ts`

- [ ] **Step 1: Wire the new deps in the api boot** — READ `apps/api/src/index.ts`. It currently builds `{ db, slack }` and calls `handleMessage({ db, slack }, …)`. Add:

```ts
import { createSlackClient } from "@poddaily/slack-client";
// ...
const secret = process.env.INTERNAL_API_SECRET ?? "";
const makeUserSlack = (token: string) => createSlackClient({ token });
// ...in the message handler:
await handleMessage({ db, slack, secret, makeUserSlack }, { slackUserId: m.user, channel: m.channel, text: m.text });
```
(`createSlackClient({ token })` inherits `SLACK_API_BASE_URL` from env — real Slack in prod, the stub in smoke.)

- [ ] **Step 2: Extend the smoke** — in `apps/api/tests/standup-smoke.test.ts`, after the existing broadcast assertions, the smoke currently drives `handleMessage({ db, slack }, …)`. Update those calls to include `secret` + `makeUserSlack`, and add the connected/unconnected assertions. READ the file for `CHAN`/`USER`/answer texts. Near the top add:

```ts
import { saveUserToken } from "@poddaily/db";
import { createSlackClient } from "@poddaily/slack-client";
const SECRET = "test-internal-api-secret-0123456789";
const makeUserSlack = (token: string) => createSlackClient({ token });
```
The existing `handleMessage({ db, slack }, …)` calls become `handleMessage({ db, slack, secret: SECRET, makeUserSlack }, …)`. Then, BEFORE the inbound replies in the main test, seed a token so this run posts as the user:

```ts
    await saveUserToken(db, SECRET, { slackUserId: USER, accessToken: "xoxp-stub-user", scopes: "chat:write" });
```
And after completion, add:

```ts
    // posted AS THE USER (user token, not the bot xoxb token)
    const channelReply = allMsgs.find((m) => m.channel === CHAN && (m as any).thread_ts);
    expect((channelReply as any).token).toBe("xoxp-stub-user");
```
(Add `token?: string` to the message type annotation in the fetch cast. Clean up the token row in `afterAll`.) Keep the existing opening-message + counter assertions.

- [ ] **Step 3: Run the smoke from repo root** (Redis + Postgres up)

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm exec vitest run apps/api/tests/standup-smoke.test.ts`
Expected: PASS — the threaded report is posted with `xoxp-stub-user`.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS — all green (crypto, tokens, oauth-state, stub, install/callback routes, sendDm, handleMessage, smoke, plus existing suites).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/tests/standup-smoke.test.ts
git commit -m "feat(api): wire user-token deps; smoke asserts post-as-user

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Definition-of-done — docs

**Files:**
- Modify: `README.md`, `ContextDB/02_architecture/slack-integration.md`, `ContextDB/00_index/getting-started.md`, `ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md`
- Create: `ContextDB/08_logs/2026-06-20-step6b-reporter-user-oauth.md`

- [ ] **Step 1: README** — **tick** the broadcast checklist line (6b completes it) and replace the 6a sub-bullet:

```markdown
- [x] Channel broadcast posted as the user, threaded under a daily opening message
  - Connected members post via their own Slack user token (true authorship, no "APP" badge, counts as a user message in Slack); unconnected members fall back to a bot post with a "Connect" nudge
```
Add to configuration/env prose: reporter user-OAuth setup — the Slack app needs the **`chat:write` user scope** + the redirect URL `${web}/api/slack/oauth/callback`; **`INTERNAL_API_SECRET` must be set on the `api` service** (decrypts tokens) as well as web; members must be **in the channel** for their token to post.

- [ ] **Step 2: `slack-integration.md`** — under "## 2. Reporter user-OAuth", add a status note: implemented in Step 6b (`/api/slack/install` + `/api/slack/oauth/callback` in apps/web; AES-GCM `slack_user_tokens`; the api posts the report with the user token, degrading to `chat:write.customize` + nudge).

- [ ] **Step 3: `getting-started.md`** — add a "Step 6b — connect to post as yourself" note: the bot DMs a Connect button to unconnected members; after connecting, reports post as the real user. Mention `pnpm smoke:standup` covers it and the `chat:write` user scope + `INTERNAL_API_SECRET` on api.

- [ ] **Step 4: ADR** — in `ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md`, change Status to `Accepted — implemented in Step 6b` (add a one-line note; don't rewrite).

- [ ] **Step 5: Build log** — create `ContextDB/08_logs/2026-06-20-step6b-reporter-user-oauth.md` (follow the 6a log's structure): What shipped (crypto, token store, OAuth install/callback, Connect button, post-as-user broadcast + degraded nudge, stub oauth fakes + token recording, smoke), Verification (`pnpm test` totals), Notable decisions (user-token = true authorship/analytics; per-user ephemeral client; worker existence-only check; degraded+nudge fallback; fallback-on-revoked; HMAC state; INTERNAL_API_SECRET now on api), and an HONEST DoD: automated smoke green; **live runbook NOT yet walked** (connect a real user; verify no "APP" badge; the user-must-be-in-channel + chat:write user-scope app config are human steps).

- [ ] **Step 6: Final verification**

Run: `docker compose up -d redis >/dev/null 2>&1; pnpm test`
Expected: all green. If anything fails, STOP and report.

- [ ] **Step 7: Commit**

```bash
git add README.md ContextDB/02_architecture/slack-integration.md ContextDB/00_index/getting-started.md ContextDB/03_decisions/2026-06-14-post-as-user-tokens.md ContextDB/08_logs/2026-06-20-step6b-reporter-user-oauth.md
git commit -m "docs: Step 6b — reporter user-OAuth (README, slack-integration, runbook, ADR, log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (against the [6b design spec](../specs/2026-06-20-step6b-reporter-user-oauth-design.md)):
- Token crypto (AES-GCM, scrypt key) → Task 1. ✓
- Token store (save/get/has, encrypted, worker existence-only) → Task 2. ✓
- OAuth state HMAC → Task 3. ✓
- Stub oauth fakes + Bearer-token recording → Task 4. ✓
- Install route (user_scope, signed state) → Task 5. ✓
- Callback route (state verify + exchange + store + success/error pages) → Task 6. ✓
- Connect button when unconnected (worker, existence-only) → Task 7. ✓
- Broadcast as user / degraded + nudge / fallback-on-revoked → Task 8. ✓
- api boot deps + smoke (post-as-user assertion via token) → Task 9. ✓
- DoD incl. README tick, ADR, user-scope + in-channel + INTERNAL_API_SECRET-on-api → Task 10. ✓
- **Deliberately deferred:** token rotation/refresh; standalone web connections page; 4h sweeper (Step 7).

**Placeholder scan:** every code step has complete code; doc steps name exact edits. Tasks 4/5/6/7/8/9 say "READ first" because they extend existing files/conventions (Next aliases, stub style, fakeSlack shape), but the edits themselves are concrete. ✓

**Type consistency:** `encryptToken`/`decryptToken(payload, secret)` defined in Task 1, consumed by Task 2. `saveUserToken(db, secret, {...})` / `getUserToken(db, secret, id)` / `hasUserToken(db, id)` defined in Task 2 and used identically in Tasks 6/7/8/9. `signState`/`verifyState(secret, state, now?)` defined Task 3, used Tasks 5/6. `HandleMessageDeps { db, slack, secret, makeUserSlack }` defined Task 8 and supplied by Task 9's boot + tests. The stub's `RecordedMessage.token` (Task 4) is asserted in Task 9's smoke. `makeUserSlack(token) => SlackClient` returns a client whose `postMessage(channel, text, { threadTs, blocks })` matches the slack-client signature (no `username` on the user path). ✓
