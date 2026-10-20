import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, createTestDb, type TestDb } from "./helpers/db";

let db: TestDb;
const ids = {
  orgA: "00000000-0000-4000-8000-0000000000a1",
  orgB: "00000000-0000-4000-8000-0000000000b1",
  adminA: "00000000-0000-4000-8000-00000000aa01",
  conA1: "00000000-0000-4000-8000-00000000ca01",
  conA2: "00000000-0000-4000-8000-00000000ca02",
  adminB: "00000000-0000-4000-8000-00000000ab01",
  conB: "00000000-0000-4000-8000-00000000cb01",
};

async function seed(db: TestDb) {
  await db.exec(`
    INSERT INTO organizations (id, name) VALUES ('${ids.orgA}', 'A'), ('${ids.orgB}', 'B');
    INSERT INTO users (id, email, name) VALUES
      ('${ids.adminA}', 'adm-a@t.local', 'x'), ('${ids.conA1}', 'c1@t.local', 'x'),
      ('${ids.conA2}', 'c2@t.local', 'x'), ('${ids.adminB}', 'adm-b@t.local', 'x'), ('${ids.conB}', 'cb@t.local', 'x');
    INSERT INTO memberships (user_id, org_id, role, status) VALUES
      ('${ids.adminA}', '${ids.orgA}', 'admin', 'active'), ('${ids.conA1}', '${ids.orgA}', 'contractor', 'active'),
      ('${ids.conA2}', '${ids.orgA}', 'contractor', 'active'), ('${ids.adminB}', '${ids.orgB}', 'admin', 'active'),
      ('${ids.conB}', '${ids.orgB}', 'contractor', 'active');
    INSERT INTO contracts (id, org_id, contractor_id, number, title, rate_type, rate_amount_gross, start_date, status) VALUES
      ('10000000-0000-4000-8000-000000000001', '${ids.orgA}', '${ids.conA1}', 'A/1', 't', 'hourly', 50, '2026-01-01', 'active'),
      ('10000000-0000-4000-8000-000000000002', '${ids.orgA}', '${ids.conA2}', 'A/2', 't', 'hourly', 50, '2026-01-01', 'active'),
      ('10000000-0000-4000-8000-000000000003', '${ids.orgB}', '${ids.conB}', 'B/1', 't', 'hourly', 50, '2026-01-01', 'active');
    INSERT INTO bills (contract_id, org_id, period, gross_amount) VALUES
      ('10000000-0000-4000-8000-000000000001', '${ids.orgA}', '2026-01', 100),
      ('10000000-0000-4000-8000-000000000002', '${ids.orgA}', '2026-01', 200),
      ('10000000-0000-4000-8000-000000000003', '${ids.orgB}', '2026-01', 300);
  `);
}

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
}, 60_000);
afterAll(async () => db.close());

const count = async (ctx: Parameters<typeof asApp>[1], table: string) =>
  asApp(db, ctx, async (d) => Number((await d.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n));

describe("RLS: izolacja organizacji (test bezpośrednio na bazie)", () => {
  it("brak kontekstu = brak wierszy (fail closed)", async () => {
    for (const t of ["contracts", "bills", "memberships", "organizations", "files", "acceptances"]) {
      expect(await count({}, t)).toBe(0);
    }
  });

  it("admin org A widzi tylko dane org A", async () => {
    const ctx = { org: ids.orgA, user: ids.adminA, role: "admin" };
    expect(await count(ctx, "contracts")).toBe(2);
    expect(await count(ctx, "bills")).toBe(2);
    expect(await count(ctx, "organizations")).toBe(1);
  });

  it("kontekst org A + user z org B nie daje danych org B", async () => {
    const ctx = { org: ids.orgA, user: ids.adminB, role: "admin" };
    const rows = await asApp(db, ctx, async (d) => (await d.query("SELECT 1 FROM contracts WHERE org_id = $1", [ids.orgB])).rows);
    expect(rows).toHaveLength(0);
  });

  it("zapis do cudzej organizacji jest odrzucony", async () => {
    const ctx = { org: ids.orgA, user: ids.adminA, role: "admin" };
    await expect(
      asApp(db, ctx, (d) =>
        d.query(
          `INSERT INTO contracts (org_id, contractor_id, number, title, rate_type, rate_amount_gross, start_date)
           VALUES ($1, $2, 'X', 't', 'hourly', 1, '2026-01-01')`,
          [ids.orgB, ids.conB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("RLS: zleceniobiorca", () => {
  const A1 = { org: ids.orgA, user: ids.conA1, role: "contractor" };

  it("widzi tylko własną umowę i rachunek", async () => {
    expect(await count(A1, "contracts")).toBe(1);
    expect(await count(A1, "bills")).toBe(1);
  });

  it("nie może utworzyć umowy ani rachunku", async () => {
    await expect(
      asApp(db, A1, (d) =>
        d.query(
          `INSERT INTO bills (contract_id, org_id, period, gross_amount) VALUES ('10000000-0000-4000-8000-000000000001', $1, '2026-02', 1)`,
          [ids.orgA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("nie zmieni cudzego rachunku (0 zmienionych wierszy)", async () => {
    const res = await asApp(db, A1, (d) =>
      d.query(`UPDATE bills SET status = 'accepted' WHERE contract_id = '10000000-0000-4000-8000-000000000002'`),
    );
    expect(res.affectedRows).toBe(0);
  });

  it("nie widzi audit logu", async () => {
    await db.exec(`INSERT INTO audit_log (org_id, action) VALUES ('${ids.orgA}', 'test')`);
    expect(await count(A1, "audit_log")).toBe(0);
  });

  it("nie widzi cudzych członkostw, ale widzi własne", async () => {
    expect(await count(A1, "memberships")).toBe(1);
  });
});

describe("RLS: księgowa i member", () => {
  it("księgowa czyta rachunki, ale nie wstawia umów", async () => {
    const ctx = { org: ids.orgA, user: ids.adminA, role: "accountant" };
    expect(await count(ctx, "bills")).toBe(2);
    await expect(
      asApp(db, ctx, (d) =>
        d.query(
          `INSERT INTO contracts (org_id, contractor_id, number, title, rate_type, rate_amount_gross, start_date)
           VALUES ($1, $2, 'Y', 't', 'hourly', 1, '2026-01-01')`,
          [ids.orgA, ids.conA1],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("księgowa może oznaczyć rachunek jako exported", async () => {
    const ctx = { org: ids.orgA, user: ids.adminA, role: "accountant" };
    const res = await asApp(db, ctx, (d) => d.query(`UPDATE bills SET status = 'exported' WHERE org_id = $1`, [ids.orgA]));
    expect(res.affectedRows).toBe(2);
  });

  it("member nie widzi audit logu, admin tak", async () => {
    expect(await count({ org: ids.orgA, user: ids.adminA, role: "member" }, "audit_log")).toBe(0);
    expect(await count({ org: ids.orgA, user: ids.adminA, role: "admin" }, "audit_log")).toBeGreaterThan(0);
  });
});

describe("audit_log jest append-only", () => {
  it("UPDATE i DELETE kończą się błędem nawet dla właściciela", async () => {
    await expect(db.exec(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
  });

  it("konto aplikacji może dopisać wpis bez org (nieudane logowanie)", async () => {
    await asApp(db, {}, (d) => d.query(`INSERT INTO audit_log (action) VALUES ('login.failed')`));
  });

  it("konto aplikacji nie może wpisać do cudzej organizacji", async () => {
    await expect(
      asApp(db, { org: ids.orgA }, (d) => d.query(`INSERT INTO audit_log (org_id, action) VALUES ($1, 'x')`, [ids.orgB])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("zaproszenia", () => {
  it("lookup/accept działają bez kontekstu i tylko raz", async () => {
    await db.exec(`
      INSERT INTO invitations (org_id, user_id, role, token_hash, expires_at)
      VALUES ('${ids.orgA}', '${ids.conA1}', 'contractor', 'hash-ok', now() + interval '1 day'),
             ('${ids.orgA}', '${ids.conA1}', 'contractor', 'hash-old', now() - interval '1 day');
    `);
    const first = await asApp(db, {}, (d) => d.query(`SELECT * FROM invitation_accept('hash-ok')`));
    expect(first.rows).toHaveLength(1);
    const again = await asApp(db, {}, (d) => d.query(`SELECT * FROM invitation_accept('hash-ok')`));
    expect(again.rows).toHaveLength(0);
    const expired = await asApp(db, {}, (d) => d.query(`SELECT * FROM invitation_accept('hash-old')`));
    expect(expired.rows).toHaveLength(0);
  });

  it("konto aplikacji bez kontekstu nie czyta tabeli zaproszeń", async () => {
    expect(await count({}, "invitations")).toBe(0);
  });
});
