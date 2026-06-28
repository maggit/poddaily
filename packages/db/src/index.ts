export * as schema from "./schema";
export { createDb } from "./client";
export { saveUserToken, getUserToken, hasUserToken, listConnectedUserIds } from "./tokens";
export { upsertDirectoryUsers, searchDirectory, countDirectoryUsers, type DirectoryMemberInput, type DirectorySearchPage } from "./directory";
export { finalizeRunIfDone } from "./runs";
export { lastReportDateBefore } from "./reports";

// Re-export the Drizzle query operators the app needs, so consumers import them
// from @poddaily/db and share this package's single drizzle-orm instance (avoids
// duplicate peer-keyed copies when a consumer like apps/web also has React).
export { eq, and, or, not, inArray, isNull, desc, asc, sql } from "drizzle-orm";
