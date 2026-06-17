import { createDb } from "@poddaily/db";

// One connection pool per process (survives Next dev HMR via globalThis).
const globalForDb = globalThis as unknown as { _poddailyDb?: ReturnType<typeof createDb> };
const instance = globalForDb._poddailyDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb._poddailyDb = instance;

export const db = instance.db;
export const sql = instance.sql;
