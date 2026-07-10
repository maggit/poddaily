// Production migration runner. Bundled by the Dockerfile into a self-contained
// dist/migrate.mjs (no node_modules needed) and run by docker-entrypoint.sh before the
// process starts — from EVERY container role (web/api/worker), so it must be safe to run
// concurrently: a session-level Postgres advisory lock serializes the runners, and the
// drizzle journal makes the migration itself idempotent (later runners see an
// up-to-date schema and no-op).
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Arbitrary app-wide lock key: "podd" as ASCII (0x706f6464). Must simply be stable
// across all poddaily containers sharing a database.
const MIGRATION_LOCK_KEY = 1886217316;

// Prefer DIRECT_URL: advisory locks and drizzle's migration transaction need a real
// session, which transaction-mode poolers (e.g. Supabase's on port 6543) don't provide.
// `||` not `??`: compose interpolation turns an unset ${DIRECT_URL} into an empty
// string, which must fall back to DATABASE_URL too.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DIRECT_URL/DATABASE_URL not set — cannot migrate");
  process.exit(1);
}
const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./migrations";

// max: 1 → a single physical connection, so the advisory lock and the migration run in
// the same session and sql.end() releases the lock even on failure.
const sql = postgres(url, { max: 1 });
try {
  await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("[migrate] schema up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  await sql.end().catch(() => {});
  process.exit(1);
}
await sql.end();
