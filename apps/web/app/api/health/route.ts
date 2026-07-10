import { sql } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import pkg from "@/package.json";

// Liveness/readiness for container orchestrators (compose healthcheck, Dokploy, k8s).
// Must never be cached or prerendered — it exists to observe the live process.
export const dynamic = "force-dynamic";

// APP_VERSION is baked into the image by the release workflow (git tag); the
// package.json version is the fallback for local/dev builds.
const version = process.env.APP_VERSION ?? pkg.version;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function check(name: string, probe: Promise<unknown>): Promise<"ok" | "error"> {
  try {
    await withTimeout(probe, 3000);
    return "ok";
  } catch (err) {
    console.error(`[health] ${name} check failed:`, err);
    return "error";
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([
    check("database", sql`select 1`.execute()),
    // bullmq types `client` as a minimal IRedisClient without `ping`, but the runtime
    // object is a full ioredis instance.
    check("redis", getQueue().client.then((c) => (c as unknown as { ping(): Promise<string> }).ping())),
  ]);
  const healthy = database === "ok" && redis === "ok";
  return Response.json(
    { status: healthy ? "ok" : "error", version, checks: { database, redis } },
    { status: healthy ? 200 : 503 },
  );
}
