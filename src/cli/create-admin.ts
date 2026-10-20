import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { invitations, memberships, organizations, users } from "../db/schema";
import { generateToken, hashToken } from "../lib/tokens";

// Tworzy organizację, konto admina i link aktywacyjny (ważny 72 h). Uruchamiane przez install.sh
// na koncie migracyjnym: docker compose run --rm migrate npx tsx src/cli/create-admin.ts <email> <imię i nazwisko> <nazwa firmy>
// Link jest wypisywany na stdout (nie do logów aplikacji). 2FA ustawiane przy pierwszym logowaniu.
const [email, name, orgName] = process.argv.slice(2);
const url = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.APP_URL;
if (!url || !appUrl || !email || !name) {
  console.error("Użycie: create-admin <email> <imię i nazwisko> [nazwa firmy]  (wymaga MIGRATION_DATABASE_URL, APP_URL)");
  process.exit(1);
}

const sqlClient = postgres(url, { max: 1 });
const db = drizzle(sqlClient);
const token = generateToken();

try {
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
    if (existing.length) throw new Error("Użytkownik o tym adresie już istnieje");
    const [org] = await tx.select({ id: organizations.id }).from(organizations).limit(1);
    const orgId = org?.id ?? (await tx.insert(organizations).values({ name: orgName ?? "Moja firma" }).returning({ id: organizations.id }))[0]!.id;
    const [user] = await tx.insert(users).values({ email: email.toLowerCase(), name }).returning({ id: users.id });
    await tx.insert(memberships).values({ userId: user!.id, orgId, role: "admin", status: "invited" });
    await tx.insert(invitations).values({ orgId, userId: user!.id, role: "admin", tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 72 * 3600_000) });
  });
  console.log(`\nLink aktywacyjny admina (ważny 72 h):\n${appUrl}/invite/${token}\n`);
} catch (err) {
  console.error("Błąd:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sqlClient.end();
}
