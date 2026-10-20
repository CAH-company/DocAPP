import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "./schema";

// Seed dev/demo. Dane wyłącznie fikcyjne (domena .local). Hasła i 2FA dochodzą w E2 (Better Auth).
// Użycie: SEED_DATABASE_URL=... tsx src/db/seed.ts [--demo]
const url = process.env.SEED_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Brak SEED_DATABASE_URL");
const demo = process.argv.includes("--demo");
const domain = demo ? "demo.local" : "dev.local";

const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);
const period = (monthsAgo: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsAgo, 1);
  return d.toISOString().slice(0, 7);
};

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

await db.transaction(async (tx) => {
  const [org] = await tx
    .insert(s.organizations)
    .values({
      name: "Firma Przykładowa Sp. z o.o.",
      nip: "0000000000",
      address: "ul. Przykładowa 1, 00-001 Warszawa",
      settings: { hours_entered_by: "admin" },
    })
    .returning();
  if (!org) throw new Error("seed: brak organizacji");

  const staff = await tx
    .insert(s.users)
    .values([
      { email: `admin@${domain}`, name: "Anna Admin" },
      { email: `ksiegowa@${domain}`, name: "Krystyna Księgowa" },
    ])
    .returning();
  const [admin, accountant] = staff;
  if (!admin || !accountant) throw new Error("seed: brak użytkowników");
  await tx.insert(s.memberships).values([
    { userId: admin.id, orgId: org.id, role: "admin", status: "active" },
    { userId: accountant.id, orgId: org.id, role: "accountant", status: "active" },
  ]);

  // 5 zleceniobiorców z różnymi przypadkami (BRIEF §6)
  const cases = [
    { key: "zleceniobiorca", name: "Zofia Student", birth: iso(-(26 * 365) + 20), student: true },
    { key: "etat", name: "Edward Etatowy", birth: "1990-05-10", student: false },
    { key: "wygasa", name: "Wiktor Wygasa", birth: "1995-03-02", student: false },
    { key: "czeka", name: "Cecylia Czeka", birth: "1988-11-23", student: false },
    { key: "odrzucony", name: "Olek Odrzucił", birth: "1992-07-14", student: false },
  ];
  for (const c of cases) {
    const [u] = await tx
      .insert(s.users)
      .values({ email: `${c.key}@${domain}`, name: c.name })
      .returning();
    if (!u) throw new Error("seed: brak zleceniobiorcy");
    await tx.insert(s.memberships).values({ userId: u.id, orgId: org.id, role: "contractor", status: "active" });
    await tx.insert(s.contractorProfiles).values({
      userId: u.id,
      orgId: org.id,
      address: "ul. Testowa 2, 00-002 Warszawa",
      birthDate: c.birth,
    });
    const [contract] = await tx
      .insert(s.contracts)
      .values({
        orgId: org.id,
        contractorId: u.id,
        number: `UZ/${c.key}/1`,
        title: "Umowa zlecenia",
        rateType: "hourly",
        rateAmountGross: "50.00",
        startDate: iso(-200),
        endDate: c.key === "wygasa" ? iso(7) : null,
        status: "active",
        source: "external",
        createdBy: admin.id,
      })
      .returning();
    if (!contract) throw new Error("seed: brak umowy");

    await tx.insert(s.contractStatements).values({
      contractId: contract.id,
      validFrom: iso(c.key === "etat" ? -400 : -200), // etat: oświadczenie starsze niż 12 mies.
      isStudentUnder26: c.student,
      studentStatusValidUntil: c.student ? iso(300) : null,
      hasEmploymentContract: c.key === "etat",
      employmentPayAtLeastMinWage: c.key === "etat" ? true : null,
      acceptedAt: new Date(),
    });

    if (c.key === "czeka" || c.key === "odrzucony") {
      await tx.insert(s.bills).values({
        contractId: contract.id,
        orgId: org.id,
        period: period(1),
        hours: "40.00",
        grossAmount: "2000.00",
        status: c.key === "czeka" ? "sent" : "rejected",
        sentAt: new Date(),
        rejectedReason: c.key === "odrzucony" ? "Zgłaszam uwagę: za mało godzin" : null,
      });
    }
  }
});

await sql.end();
console.log(`Seed zakończony (${demo ? "demo" : "dev"})`);
