import { createServer, type Server } from "node:net";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { ClamdScanner, ScannerUnavailableError, __setScannerForTests, type Scanner } from "@/lib/files/clamav";
import { LocalStorageDriver, __setStorageForTests } from "@/lib/files/storage";
import { FileRejectedError } from "@/lib/files/types";
import type { AuthContext } from "@/lib/session";
import { deleteFile, openFile, uploadFile } from "@/server/files";
import { createTestDb, type TestDb } from "./helpers/db";

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "https://app.test",
  DATABASE_URL: "postgres://unused",
  MASTER_KEY: "ab".repeat(32),
  AUTH_SECRET: "s".repeat(40),
  SMTP_HOST: "smtp.test",
  SMTP_FROM: "noreply@app.test",
  MAX_UPLOAD_MB: "1",
});

const storageDir = mkdtempSync(join(tmpdir(), "obieg-files-"));
let pg: TestDb;
let adminA: AuthContext, contractorA1: AuthContext, contractorA2: AuthContext, adminB: AuthContext, accountantA: AuthContext;
let contractA1Id: string;
let scanResult: "clean" | "infected" | "down" = "clean";

const scanner: Scanner = {
  async scan(data) {
    for await (const _ of data) void _; // zużyj strumień
    if (scanResult === "down") throw new ScannerUnavailableError("test");
    return scanResult === "clean" ? { clean: true } : { clean: false, signature: "Eicar-Test-Signature" };
  },
};

const pdf = (body = "treść") => new File([Buffer.from(`%PDF-1.7\n${body}`)], "umowa.pdf", { type: "application/pdf" });
const ownerExec = async <T>(fn: () => Promise<T>) => {
  await pg.exec("RESET ROLE");
  try {
    return await fn();
  } finally {
    await pg.exec("SET ROLE app");
  }
};
const countFiles = () => readdirSync(storageDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

beforeAll(async () => {
  pg = await createTestDb();
  const db = drizzle(pg as unknown as PGlite, { schema });
  __setDbForTests(db);
  __setStorageForTests(new LocalStorageDriver(storageDir));
  __setScannerForTests(scanner);

  const [orgA] = await db.insert(schema.organizations).values({ name: "A" }).returning();
  const [orgB] = await db.insert(schema.organizations).values({ name: "B" }).returning();
  const mk = async (email: string, org: string, role: AuthContext["role"]) => {
    const [u] = await db.insert(schema.users).values({ email, name: "x" }).returning();
    await db.insert(schema.memberships).values({ userId: u!.id, orgId: org, role, status: "active" });
    return { userId: u!.id, orgId: org, role, sessionId: "s", twoFactorEnabled: true, needs2faSetup: false } as AuthContext;
  };
  adminA = await mk("a@t.local", orgA!.id, "admin");
  accountantA = await mk("k@t.local", orgA!.id, "accountant");
  contractorA1 = await mk("c1@t.local", orgA!.id, "contractor");
  contractorA2 = await mk("c2@t.local", orgA!.id, "contractor");
  adminB = await mk("b@t.local", orgB!.id, "admin");
  const [c] = await db
    .insert(schema.contracts)
    .values({ orgId: orgA!.id, contractorId: contractorA1.userId, number: "A/1", title: "t", rateType: "hourly", rateAmountGross: "10", startDate: "2026-01-01" })
    .returning();
  contractA1Id = c!.id;
  await pg.exec("SET ROLE app");
}, 60_000);

afterAll(async () => {
  await pg.close();
  rmSync(storageDir, { recursive: true, force: true });
});

async function readAll(r: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe("upload", () => {
  it("zapisuje zaszyfrowany plik; surowy plik w wolumenie nie jest czytelnym PDF", async () => {
    const saved = await uploadFile(adminA, pdf("sekretna treść umowy"), { relatedType: "contract", relatedId: contractA1Id }, "1.2.3.4");
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);

    const files = readdirSync(storageDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(files[0]!.parentPath, files[0]!.name));
    expect(raw.includes(Buffer.from("%PDF-"))).toBe(false);
    expect(raw.includes(Buffer.from("sekretna"))).toBe(false);
    expect(files[0]!.name).toMatch(/^[0-9a-f-]{36}$/); // losowy UUID, bez oryginalnej nazwy
    expect(statSync(join(files[0]!.parentPath, files[0]!.name)).size).toBeGreaterThan(30);
  });

  it("odrzuca pliki spoza whitelisty, z fałszywym MIME lub bez zgodnych magic bytes", async () => {
    const meta = { relatedType: "document" };
    const exe = new File([Buffer.from("MZ\x90\x00")], "x.pdf", { type: "application/pdf" });
    await expect(uploadFile(adminA, exe, meta, null)).rejects.toMatchObject({ reason: "type" });
    const wrongMime = new File([Buffer.from("%PDF-1.7")], "x.pdf", { type: "text/html" });
    await expect(uploadFile(adminA, wrongMime, meta, null)).rejects.toMatchObject({ reason: "type" });
    const wrongExt = new File([Buffer.from("%PDF-1.7")], "x.html", { type: "application/pdf" });
    await expect(uploadFile(adminA, wrongExt, meta, null)).rejects.toMatchObject({ reason: "type" });
  });

  it("odrzuca pusty plik i plik ponad limit", async () => {
    await expect(uploadFile(adminA, new File([], "x.pdf", { type: "application/pdf" }), { relatedType: "document" }, null)).rejects.toMatchObject({ reason: "empty" });
    const big = new File([Buffer.alloc(1024 * 1024 + 1, 1)], "x.pdf", { type: "application/pdf" });
    await expect(uploadFile(adminA, big, { relatedType: "document" }, null)).rejects.toMatchObject({ reason: "size" });
  });

  it("zainfekowany plik: odrzucony, nic nie zapisane, wpis w audit logu bez nazwy pliku", async () => {
    const before = countFiles();
    scanResult = "infected";
    await expect(uploadFile(adminA, pdf("eicar"), { relatedType: "document" }, null)).rejects.toBeInstanceOf(FileRejectedError);
    scanResult = "clean";
    expect(countFiles()).toBe(before);
    const rows = await ownerExec(async () => (await pg.query<{ metadata: object }>("SELECT metadata FROM audit_log WHERE action = 'file.infected'")).rows);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("umowa.pdf");
  });

  it("skaner niedostępny = upload zablokowany (fail closed)", async () => {
    const before = countFiles();
    scanResult = "down";
    await expect(uploadFile(adminA, pdf(), { relatedType: "document" }, null)).rejects.toBeInstanceOf(ScannerUnavailableError);
    scanResult = "clean";
    expect(countFiles()).toBe(before);
  });

  it("powiązanie z cudzą umową jest odrzucone", async () => {
    await expect(uploadFile(contractorA2, pdf(), { relatedType: "contract", relatedId: contractA1Id }, null)).rejects.toMatchObject({ reason: "related" });
    await expect(uploadFile(adminB, pdf(), { relatedType: "contract", relatedId: contractA1Id }, null)).rejects.toMatchObject({ reason: "related" });
  });

  it("księgowa nie wgrywa plików (authz)", async () => {
    await expect(uploadFile(accountantA, pdf(), { relatedType: "document" }, null)).rejects.toThrow("forbidden");
  });

  it("odrzuca nieznane pola metadanych", async () => {
    await expect(uploadFile(adminA, pdf(), { relatedType: "document", orgId: "x" }, null)).rejects.toThrow();
  });
});

describe("pobieranie", () => {
  let fileId: string;
  beforeAll(async () => {
    fileId = (await uploadFile(contractorA1, pdf("moja umowa"), { relatedType: "contract", relatedId: contractA1Id }, null)).id;
  });

  it("właściciel dostaje oryginalną treść, a hash się zgadza", async () => {
    const f = await openFile(contractorA1, fileId, null, true);
    expect(f).not.toBeNull();
    expect((await readAll(f!.stream)).toString()).toBe("%PDF-1.7\nmoja umowa");
    expect(f!.inline).toBe(true);
  });

  it("brak dostępu przez zgadnięcie ID: inny zleceniobiorca i inna organizacja dostają null", async () => {
    expect(await openFile(contractorA2, fileId, null)).toBeNull();
    expect(await openFile(adminB, fileId, null)).toBeNull();
    expect(await openFile(adminA, "00000000-0000-4000-8000-000000000000", null)).toBeNull();
  });

  it("personel firmy i księgowa mają dostęp", async () => {
    expect(await openFile(adminA, fileId, null)).not.toBeNull();
    expect(await openFile(accountantA, fileId, null)).not.toBeNull();
  });

  it("pobranie trafia do audit logu", async () => {
    const n = await ownerExec(async () => Number((await pg.query<{ n: string }>("SELECT count(*) n FROM audit_log WHERE action = 'file.downloaded'")).rows[0]!.n));
    expect(n).toBeGreaterThan(0);
  });

  it("uszkodzony plik na dysku nie zostanie oddany jako poprawny", async () => {
    const key = await ownerExec(async () => (await pg.query<{ storage_key: string }>("SELECT storage_key FROM files WHERE id = $1", [fileId])).rows[0]!.storage_key);
    const target = join(storageDir, key.slice(0, 2), key);
    const buf = readFileSync(target);
    buf[buf.length - 3]! ^= 0xff;
    writeFileSync(target, buf);
    const f = await openFile(adminA, fileId, null);
    await expect(readAll(f!.stream)).rejects.toThrow();
  });
});

describe("usuwanie", () => {
  it("usuwa plik z magazynu, nie tylko flagę; zleceniobiorca nie może usuwać", async () => {
    const saved = await uploadFile(adminA, pdf("do usunięcia"), { relatedType: "document" }, null);
    const before = countFiles();
    await expect(deleteFile(contractorA1, saved.id, null)).rejects.toThrow("forbidden");
    expect(await deleteFile(adminA, saved.id, null)).toBe(true);
    expect(countFiles()).toBe(before - 1);
    expect(await openFile(adminA, saved.id, null)).toBeNull();
    expect(await deleteFile(adminA, saved.id, null)).toBe(false);
  });
});

describe("klient clamd (protokół zINSTREAM)", () => {
  function fakeClamd(reply: string): Promise<{ server: Server; port: number; received: () => Buffer }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const server = createServer((sock) => {
        sock.on("data", (c) => {
          chunks.push(c);
          if (Buffer.concat(chunks).subarray(-4).equals(Buffer.alloc(4))) sock.end(reply + "\0");
        });
      }).listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, received: () => Buffer.concat(chunks) }));
    });
  }

  it("czysty plik", async () => {
    const f = await fakeClamd("stream: OK");
    const res = await new ClamdScanner("127.0.0.1", f.port).scan(Readable.from([Buffer.from("abc")]));
    expect(res).toEqual({ clean: true });
    expect(f.received().subarray(0, 10).toString()).toBe("zINSTREAM\0");
    f.server.close();
  });

  it("wykrycie sygnatury", async () => {
    const f = await fakeClamd("stream: Win.Test.EICAR_HDB-1 FOUND");
    const res = await new ClamdScanner("127.0.0.1", f.port).scan(Readable.from([Buffer.from("abc")]));
    expect(res).toEqual({ clean: false, signature: "Win.Test.EICAR_HDB-1" });
    f.server.close();
  });

  it("błąd clamd lub brak połączenia = ScannerUnavailableError", async () => {
    const f = await fakeClamd("INSTREAM size limit exceeded. ERROR");
    await expect(new ClamdScanner("127.0.0.1", f.port).scan(Readable.from([Buffer.from("abc")]))).rejects.toBeInstanceOf(ScannerUnavailableError);
    f.server.close();
    await expect(new ClamdScanner("127.0.0.1", 1).scan(Readable.from([Buffer.from("abc")]))).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});
