import { eq } from "drizzle-orm";
import { memberships, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/session";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

const roleLabel = { admin: "Administrator", member: "Pracownik firmy", accountant: "Księgowa", contractor: "Zleceniobiorca" } as const;
const statusLabel = { invited: "zaproszony", active: "aktywny", disabled: "wyłączony" } as const;

export default async function UsersPage() {
  const ctx = await requireAuth("users.manage");
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, ctx.orgId))
      .orderBy(users.name),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Użytkownicy</h1>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Użytkownicy organizacji</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2">Imię i nazwisko</th>
            <th scope="col">E-mail</th>
            <th scope="col">Rola</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{r.name}</td>
              <td>{r.email}</td>
              <td>{roleLabel[r.role]}</td>
              <td>{statusLabel[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-3 mt-10 text-lg font-semibold">Zaproś osobę</h2>
      <InviteForm />
    </main>
  );
}
