import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { memberships, sessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { assertCan, IDLE_TIMEOUT_MIN, TWO_FACTOR_REQUIRED, type Action, type Role } from "./authz";
import { getAuth } from "./auth";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  sessionId: string;
  twoFactorEnabled: boolean;
  /** Rola wymaga 2FA, a użytkownik jeszcze go nie włączył: dostęp tylko do /setup-2fa. */
  needs2faSetup: boolean;
}

const ACTIVITY_BUMP_MS = 60_000;

/** Pełne ustalenie kontekstu: sesja + członkostwo + limit bezczynności. null = niezalogowany. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const auth = getAuth();
  const data = await auth.api.getSession({ headers: await headers() });
  if (!data) return null;

  const [membership] = await withTenant({ userId: data.user.id }, (tx) =>
    tx
      .select({ orgId: memberships.orgId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, data.user.id), eq(memberships.status, "active")))
      .limit(1),
  );
  if (!membership) return null;

  const idleMin = IDLE_TIMEOUT_MIN[membership.role];
  const sinceActivity = Date.now() - new Date(data.session.updatedAt).getTime();
  if (idleMin !== null && sinceActivity > idleMin * 60_000) {
    await getDb().delete(sessions).where(eq(sessions.id, data.session.id));
    return null;
  }
  if (sinceActivity > ACTIVITY_BUMP_MS) {
    await getDb().update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, data.session.id));
  }

  const twoFactorEnabled = Boolean((data.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  return {
    userId: data.user.id,
    orgId: membership.orgId,
    role: membership.role,
    sessionId: data.session.id,
    twoFactorEnabled,
    needs2faSetup: TWO_FACTOR_REQUIRED.includes(membership.role) && !twoFactorEnabled,
  };
});

/** Strażnik dla stron i akcji: wymusza logowanie, 2FA i (opcjonalnie) uprawnienie. */
export async function requireAuth(action?: Action, opts: { allowWithout2fa?: boolean } = {}): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.needs2faSetup && !opts.allowWithout2fa) redirect("/setup-2fa");
  if (action) assertCan(ctx.role, action);
  return ctx;
}
