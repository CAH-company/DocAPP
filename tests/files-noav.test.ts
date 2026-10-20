import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { __setScannerForTests } from "@/lib/files/clamav";
import { LocalStorageDriver, __setStorageForTests } from "@/lib/files/storage";
import type { AuthContext } from "@/lib/session";
import { openFile, uploadFile } from "@/server/files";
import { createTestDb, type TestDb } from "./helpers/db";

// Wersja testowa bez ClamAV (docs/TODO.md): skaner nie może być wołany, a plik dostaje status "skipped".
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "https://app.test",
  DATABASE_URL: "postgres://unused",
  MASTER_KEY: "ab".repeat(32),
  AUTH_SECRET: "s".repeat(40),
  SMTP_HOST: "smtp.test",
  SMTP_FROM: "noreply@app.test",
  CLAMAV_ENABLED: "false",
});

const dir = mkdtempSync(join(tmpdir(), "obieg-noav-"));
let pg: TestDb;
let admin: AuthContext;

beforeAll(async () => {
  pg = await createTestDb();
  const db = drizzle(pg as unknown as PGlite, { schema });
  __setDbForTests(db);
  __setStorageForTests(new LocalStorageDriver(dir));
  __setScannerForTests({
    scan() {
      throw new Error("skaner nie powinien być wołany przy CLAMAV_ENABLED=false");
    },
  });
  const [org] = await db.insert(schema.organizations).values({ name: "A" }).returning();
  const [u] = await db.insert(schema.users).values({ email: "a@t.local", name: "x" }).returning();
  await db.insert(schema.memberships).values({ userId: u!.id, orgId: org!.id, role: "admin", status: "active" });
  admin = { userId: u!.id, orgId: org!.id, role: "admin", sessionId: "s", twoFactorEnabled: true, needs2faSetup: false };
  await pg.exec("SET ROLE app");
}, 60_000);

afterAll(async () => {
  await pg.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("tryb testowy bez antywirusa", () => {
  it("zapisuje plik ze statusem skipped, szyfruje go i pozwala pobrać", async () => {
    const file = new File([Buffer.from("%PDF-1.7\ntest")], "a.pdf", { type: "application/pdf" });
    const saved = await uploadFile(admin, file, { relatedType: "document" }, null);

    await pg.exec("RESET ROLE");
    const row = (await pg.query<{ scan_status: string }>("SELECT scan_status FROM files WHERE id = $1", [saved.id])).rows[0]!;
    const audit = (await pg.query<{ metadata: { scan: string } }>("SELECT metadata FROM audit_log WHERE action = 'file.uploaded'")).rows[0]!;
    await pg.exec("SET ROLE app");

    expect(row.scan_status).toBe("skipped");
    expect(audit.metadata.scan).toBe("skipped");
    const opened = await openFile(admin, saved.id, null);
    expect(opened).not.toBeNull();
    opened!.stream.destroy();
  });
});
