import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Create the Drizzle client + underlying postgres.js connection.
 *
 * Call ONCE per process at startup and reuse the returned `db`; calling this
 * per request would open a new connection pool each time and exhaust connections.
 * The caller owns lifecycle — `await sql.end()` to close (e.g. in scripts/tests).
 *
 * `prepare: false` is required for the Supabase transaction-mode pooler (port 6543),
 * which does not support prepared statements; it is also safe for direct connections.
 */
export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const sql = postgres(connectionString, { max: 10, prepare: false });
  return { db: drizzle(sql, { schema }), sql };
}
