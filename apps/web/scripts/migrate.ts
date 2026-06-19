import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DIRECT_URL/DATABASE_URL not set — cannot migrate");
  process.exit(1);
}
const migrationsFolder = process.env.MIGRATIONS_DIR ?? "./migrations";
const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("[migrate] schema up to date");
} catch (err) {
  console.error("[migrate] failed:", err);
  await sql.end();
  process.exit(1);
}
await sql.end();
