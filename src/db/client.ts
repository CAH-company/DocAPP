import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres>; testDb?: Db };

export function getSql() {
  globalForDb.sql ??= postgres(getEnv().DATABASE_URL, { max: 10, prepare: true });
  return globalForDb.sql;
}

export function getDb(): Db {
  return globalForDb.testDb ?? drizzle(getSql(), { schema });
}

/** Tylko dla testów: podmienia bazę (np. PGlite). */
export function __setDbForTests(db: unknown) {
  globalForDb.testDb = db as Db;
}

/** postgres-js zwraca tablicę, PGlite obiekt z `rows`. */
export function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}
