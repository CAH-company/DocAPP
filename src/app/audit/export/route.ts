import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/authz";
import { getAuthContext } from "@/lib/session";

export const dynamic = "force-dynamic";

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // ochrona przed formułami w arkuszu
  return `"${s.replaceAll('"', '""')}"`;
};

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.needs2faSetup) return new NextResponse(null, { status: 401 });
  if (ctx.role !== "admin") return new NextResponse(null, { status: 403 });

  const actionParam = new URL(req.url).searchParams.get("action");
  const filter = AUDIT_ACTIONS.find((a) => a === actionParam);

  try {
    const csv = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(auditLog)
        .where(filter ? eq(auditLog.action, filter) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(50_000);
      await writeAudit(tx, { action: "export.run", orgId: ctx.orgId, actorUserId: ctx.userId, metadata: { kind: "audit_log", rows: rows.length } });
      const head = ["created_at", "action", "actor_user_id", "entity_type", "entity_id", "ip", "metadata"];
      return [head.join(","), ...rows.map((r) => [r.createdAt.toISOString(), r.action, r.actorUserId, r.entityType, r.entityId, r.ip, JSON.stringify(r.metadata)].map(csvCell).join(","))].join("\n");
    });
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-log.csv"', "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse(null, { status: 403 });
    throw err;
  }
}
