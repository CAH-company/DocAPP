import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { auditLog } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { withTenant } from "@/db/tenant";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const ctx = await requireAuth("audit.read");
  const { action } = await searchParams;
  const filter = AUDIT_ACTIONS.find((a) => a === action);

  const rows = await withTenant(ctx, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(filter ? eq(auditLog.action, filter) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(200),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-4 text-2xl font-semibold">Dziennik zdarzeń</h1>
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="action" className="block text-sm font-medium">
            Zdarzenie
          </label>
          <select id="action" name="action" defaultValue={filter ?? ""} className="min-h-11 rounded-md border border-slate-400 px-3">
            <option value="">Wszystkie</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <button className="min-h-11 rounded-md border border-slate-400 px-4">Filtruj</button>
        <Link className="min-h-11 content-center underline" href={`/audit/export${filter ? `?action=${filter}` : ""}`} prefetch={false}>
          Eksport CSV
        </Link>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Ostatnie 200 zdarzeń</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-2">Czas</th>
              <th scope="col">Zdarzenie</th>
              <th scope="col">Wykonawca (ID)</th>
              <th scope="col">Obiekt (ID)</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 whitespace-nowrap">{r.createdAt.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}</td>
                <td>{r.action}</td>
                <td className="font-mono text-xs">{r.actorUserId?.slice(0, 8) ?? "-"}</td>
                <td className="font-mono text-xs">{r.entityId?.slice(0, 8) ?? "-"}</td>
                <td>{r.ip ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
