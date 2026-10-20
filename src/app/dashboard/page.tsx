import Link from "next/link";
import { can } from "@/lib/authz";
import { requireAuth } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

const roleLabel = { admin: "Administrator", member: "Pracownik firmy", accountant: "Księgowa", contractor: "Zleceniobiorca" } as const;

export default async function DashboardPage() {
  const ctx = await requireAuth();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Pulpit</h1>
      <p className="mt-1 text-slate-600">Rola: {roleLabel[ctx.role]}</p>
      <p className="mt-6 text-sm text-slate-600">Sekcje „do zrobienia” pojawią się w kolejnym etapie.</p>
      <nav aria-label="Sekcje" className="mt-6 flex flex-wrap gap-3">
        {can(ctx.role, "users.manage") && (
          <Link className="underline" href="/settings/users">
            Użytkownicy
          </Link>
        )}
        {can(ctx.role, "audit.read") && (
          <Link className="underline" href="/audit">
            Dziennik zdarzeń
          </Link>
        )}
      </nav>
      <div className="mt-8">
        <LogoutButton />
      </div>
    </main>
  );
}
