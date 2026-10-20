import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "src/db/migrations");

/** Baza w pamięci z prawdziwymi migracjami i rolą `app` bez uprawnień właściciela (jak w db-init.sh). */
export async function createTestDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const statements = readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint");
    for (const stmt of statements) if (stmt.trim()) await db.exec(stmt);
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export interface Ctx {
  org?: string;
  user?: string;
  role?: string;
}

/** Wykonuje zapytania jako konto aplikacji z danym kontekstem (jak withTenant). */
export async function asApp<T>(db: TestDb, ctx: Ctx, fn: (db: TestDb) => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.exec("SET LOCAL ROLE app");
    await db.query("SELECT set_config('app.current_org', $1, true), set_config('app.current_user', $2, true), set_config('app.current_role', $3, true)", [
      ctx.org ?? "",
      ctx.user ?? "",
      ctx.role ?? "",
    ]);
    const out = await fn(db);
    await db.exec("COMMIT");
    return out;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
