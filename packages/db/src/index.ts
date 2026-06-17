export * as schema from "./schema";
export { createDb } from "./client";

// Re-export the Drizzle query operators the app needs, so consumers import them
// from @poddaily/db and share this package's single drizzle-orm instance (avoids
// duplicate peer-keyed copies when a consumer like apps/web also has React).
export { eq, and, or, not, inArray, desc, asc, sql } from "drizzle-orm";
