import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { __setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { hashToken } from "@/lib/tokens";
import { acceptInvitation, inviteUser, lookupInvitation } from "@/server/invitations";
import type { AuthContext } from "@/lib/session";
import { createTestDb, type TestDb } from "./helpers/db";

const sent: { to: string; text: string }[] = [];
vi.mock("@/lib/mailer", () => ({ sendMail: async (m: { to: string; text: string }) => void sent.push(m) }));

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "https://app.test",
  DATABASE_URL: "postgres://unused",
  MASTER_KEY: "a".repeat(64),
  AUTH_SECRET: "s".repeat(40),
  SMTP_HOST: "smtp.test",
  SMTP_FROM: "noreply@app.test",
});

let pg: TestDb;
let db: ReturnType<typeof drizzle<typeof schema>>;
let admin: AuthContext;
const PASSWORD = "correct horse battery 1";

beforeAll(async () => {
  pg = await createTestDb();
  db = drizzle(pg as unknown as PGlite, { schema });
  __setDbForTests(db);
  const [org] = await db.insert(schema.organizations).values({ name: "Test" }).returning();
  const [u] = await db.insert(schema.users).values({ email: "admin@t.local", name: "Admin" }).returning();
  await db.insert(schema.memberships).values({ userId: u!.id, orgId: org!.id, role: "admin", status: "active" });
  admin = { userId: u!.id, orgId: org!.id, role: "admin", sessionId: "s", twoFactorEnabled: true, needs2faSetup: false };
  await pg.exec("SET ROLE app"); // od teraz wszystko działa jak konto aplikacji (RLS obowiązuje)
}, 60_000);
afterAll(async () => pg.close());

/** Odczyt jako właściciel (poza RLS), żeby sprawdzić stan bazy. */
async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec("RESET ROLE");
  try {
    return await fn();
  } finally {
    await pg.exec("SET ROLE app");
  }
}

function tokenFromMail(): string {
  const mail = sent.at(-1)!;
  return mail.text.match(/\/invite\/([\w-]+)/)![1]!;
}

describe("zaproszenia i logowanie", () => {
  it("admin zaprasza zleceniobiorcę; mail zawiera link, w bazie jest tylko hash", async () => {
    await inviteUser(admin, { email: "Zlec@T.local", name: "Zofia Zleceniobiorca", role: "contractor" }, "1.2.3.4");
    const token = tokenFromMail();
    const [inv] = await asOwner(() => db.select().from(schema.invitations));
    expect(inv!.tokenHash).toBe(hashToken(token));
    expect(inv!.tokenHash).not.toContain(token);
    expect(inv!.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000);
  });

  it("member nie może zaprosić admina", async () => {
    const member = { ...admin, role: "member" as const };
    await expect(inviteUser(member, { email: "x@t.local", name: "Xx", role: "admin" }, null)).rejects.toThrow("forbidden");
  });

  it("zaproszenie nie przyjmuje nieznanych pól", async () => {
    await expect(inviteUser(admin, { email: "y@t.local", name: "Yy", role: "contractor", isAdmin: true }, null)).rejects.toThrow();
  });

  it("akceptacja ustawia hasło, aktywuje członkostwo i jest jednorazowa", async () => {
    const token = tokenFromMail();
    expect(await lookupInvitation(token)).not.toBeNull();
    await expect(acceptInvitation({ token, password: "krótkie", clauseAccepted: true }, null)).rejects.toThrow();
    await expect(acceptInvitation({ token, password: PASSWORD, clauseAccepted: false }, null)).rejects.toThrow();
    await acceptInvitation({ token, password: PASSWORD, clauseAccepted: true }, "1.2.3.4");

    const [m] = await asOwner(() => db.select().from(schema.memberships).where(eq(schema.memberships.role, "contractor")));
    expect(m!.status).toBe("active");
    expect(await lookupInvitation(token)).toBeNull();
    await expect(acceptInvitation({ token, password: PASSWORD, clauseAccepted: true }, null)).rejects.toThrow("invalid");
  });

  it("wygasłe zaproszenie jest odrzucane", async () => {
    await inviteUser(admin, { email: "old@t.local", name: "Stary Token", role: "contractor" }, null);
    const token = tokenFromMail();
    await pg.exec("RESET ROLE");
    await pg.exec("UPDATE invitations SET expires_at = now() - interval '1 minute'");
    await pg.exec("SET ROLE app");
    expect(await lookupInvitation(token)).toBeNull();
  });

  it("logowanie poprawnym hasłem działa, a hasło jest zahashowane (nie jawne)", async () => {
    const res = await getAuth().api.signInEmail({ body: { email: "zlec@t.local", password: PASSWORD } });
    expect(res.user.email).toBe("zlec@t.local");
    const [acc] = await db.select().from(schema.accounts);
    expect(acc!.password).not.toContain(PASSWORD);
  });

  it("po 5 błędnych próbach konto jest blokowane, także dla poprawnego hasła", async () => {
    const auth = getAuth();
    for (let i = 0; i < 5; i++) {
      await expect(auth.api.signInEmail({ body: { email: "zlec@t.local", password: "złe hasło 12345" } })).rejects.toThrow();
    }
    await expect(auth.api.signInEmail({ body: { email: "zlec@t.local", password: PASSWORD } })).rejects.toThrow();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "zlec@t.local"));
    expect(u!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("wyłączone konto nie zaloguje się", async () => {
    await pg.exec("RESET ROLE");
    await pg.exec("UPDATE users SET status = 'disabled', locked_until = NULL WHERE email = 'zlec@t.local'");
    await pg.exec("SET ROLE app");
    await expect(getAuth().api.signInEmail({ body: { email: "zlec@t.local", password: PASSWORD } })).rejects.toThrow();
  });

  it("publiczna rejestracja jest wyłączona", async () => {
    await expect(
      getAuth().api.signUpEmail({ body: { email: "intruz@t.local", password: PASSWORD, name: "Intruz" } }),
    ).rejects.toThrow();
  });

  it("w audit logu są wpisy bez danych osobowych w metadanych", async () => {
    await pg.exec("RESET ROLE");
    const rows = (await pg.query<{ action: string; metadata: unknown }>("SELECT action, metadata FROM audit_log")).rows;
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["user.invited", "user.invitation_accepted", "auth.login_failed"]));
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/@t\.local/);
    expect(blob).not.toContain("Zofia");
  });
});
