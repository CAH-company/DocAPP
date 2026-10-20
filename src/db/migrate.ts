import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Osobny krok z kontem migracyjnym (SECURITY_RODO §5). Bez getEnv(),
// bo kontener migrate nie ma MASTER_KEY.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("Brak MIGRATION_DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), {
    migrationsFolder: process.env.MIGRATIONS_DIR ?? "./src/db/migrations",
  });
  console.log("Migracje zastosowane");
} catch (err) {
  console.error("Migracja nieudana:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
