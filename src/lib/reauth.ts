import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { getAuth, auditAuth } from "./auth";
import type { AuthContext } from "./session";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Ponowne uwierzytelnienie hasłem przed akceptacją dokumentu, eksportem, zmianą nr konta/ról, usuwaniem
 * (SECURITY_RODO §5). Zwraca false przy błędnym haśle; blokuje po 5 próbach, tak jak logowanie.
 */
export async function verifyReauth(actor: AuthContext, password: string, ip: string | null): Promise<boolean> {
  const db = getDb();
  const [user] = await db.select({ lockedUntil: users.lockedUntil, failed: users.failedLoginCount }).from(users).where(eq(users.id, actor.userId));
  if (!user || (user.lockedUntil && user.lockedUntil > new Date())) return false;

  const [account] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, actor.userId), eq(accounts.providerId, "credential")));
  const ctx = await getAuth().$context;
  const ok = Boolean(account?.password) && (await ctx.password.verify({ hash: account!.password!, password }));
  if (ok) {
    if (user.failed > 0) await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, actor.userId));
    return true;
  }
  const failed = user.failed + 1;
  const lock = failed >= MAX_FAILURES;
  await db
    .update(users)
    .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
    .where(eq(users.id, actor.userId));
  await auditAuth("auth.reauth_failed", actor.userId, ip);
  return false;
}
