import { sql } from "drizzle-orm";
import { getDb } from "./client";
import type { Role } from "@/lib/authz";

export interface TenantContext {
  orgId?: string;
  userId?: string;
  role?: Role;
}

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Jedyna droga do danych domenowych. Ustawia kontekst dla Postgres RLS (transakcyjnie,
 * `set_config(..., true)`), więc błąd w warstwie repozytoriów nie ujawni cudzych wierszy.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', ${ctx.orgId ?? ""}, true),
                 set_config('app.current_user', ${ctx.userId ?? ""}, true),
                 set_config('app.current_role', ${ctx.role ?? ""}, true)`,
    );
    return fn(tx);
  });
}
