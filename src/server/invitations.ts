import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, rowsOf } from "@/db/client";
import { accounts, invitations, memberships, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { t } from "@/i18n";
import { writeAudit } from "@/lib/audit";
import { canInviteRole, ROLES, type Role } from "@/lib/authz";
import { getAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import type { AuthContext } from "@/lib/session";
import { generateToken, hashToken } from "@/lib/tokens";

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export const inviteInput = z.strictObject({
  email: z.email().max(254),
  name: z.string().trim().min(2).max(120),
  role: z.enum(ROLES),
});

export const acceptInput = z.strictObject({
  token: z.string().min(40).max(128),
  password: z.string().min(12).max(128),
  clauseAccepted: z.literal(true),
});

export class InviteError extends Error {}

/** Treść klauzuli RODO, której hash zapisujemy przy akceptacji (konfigurowalna przez admina w E5). */
export function rodoClauseText(): string {
  return t("rodo.clause");
}
export const clauseHash = () => createHash("sha256").update(rodoClauseText()).digest("hex");

export async function inviteUser(actor: AuthContext, raw: unknown, ip: string | null): Promise<void> {
  const input = inviteInput.parse(raw);
  if (!canInviteRole(actor.role, input.role)) throw new InviteError("forbidden");

  const token = generateToken();
  const email = input.email.toLowerCase();

  await withTenant({ orgId: actor.orgId, userId: actor.userId, role: actor.role }, async (tx) => {
    // Użytkownik może istnieć tylko jako osoba już zaproszona do tej organizacji.
    let [user] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (user) {
      const [m] = await tx.select({ status: memberships.status }).from(memberships).where(eq(memberships.userId, user.id)).limit(1);
      if (m?.status === "active") throw new InviteError("exists");
      if (!m) throw new InviteError("exists"); // konto istnieje poza tą organizacją: nie ujawniamy szczegółów
    } else {
      [user] = await tx.insert(users).values({ email, name: input.name }).returning({ id: users.id });
      await tx.insert(memberships).values({ userId: user!.id, orgId: actor.orgId, role: input.role, status: "invited", invitedBy: actor.userId });
    }
    await tx.insert(invitations).values({
      orgId: actor.orgId,
      userId: user!.id,
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      invitedBy: actor.userId,
    });
    await writeAudit(tx, { action: "user.invited", orgId: actor.orgId, actorUserId: actor.userId, entityType: "user", entityId: user!.id, metadata: { role: input.role }, ip });
  });

  const link = `${getEnv().APP_URL}/invite/${token}`;
  await sendMail({ to: email, subject: t("mail.invite.subject"), text: `${t("mail.invite.body")}\n\n${link}\n\n${t("mail.invite.ignore")}` });
}

/** Sprawdza token bez ujawniania powodu odrzucenia. */
export async function lookupInvitation(token: string) {
  if (token.length < 40 || token.length > 128) return null;
  const res = await getDb().execute(sql`select * from invitation_lookup(${hashToken(token)})`);
  return rowsOf<{ org_id: string; user_id: string; role: Role }>(res)[0] ?? null;
}

export async function acceptInvitation(raw: unknown, ip: string | null): Promise<void> {
  const input = acceptInput.parse(raw);
  const res = await getDb().execute(sql`select * from invitation_accept(${hashToken(input.token)})`);
  const row = rowsOf<{ org_id: string; user_id: string; role: Role }>(res)[0];
  if (!row) throw new InviteError("invalid");

  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(input.password);
  await getDb().transaction(async (tx) => {
    await tx.insert(accounts).values({ accountId: row.user_id, providerId: "credential", userId: row.user_id, password: hash });
    await tx.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, row.user_id));
  });
  await withTenant({ orgId: row.org_id, userId: row.user_id, role: row.role }, (tx) =>
    writeAudit(tx, {
      action: "user.invitation_accepted",
      orgId: row.org_id,
      actorUserId: row.user_id,
      entityType: "user",
      entityId: row.user_id,
      metadata: { clause_sha256: clauseHash() },
      ip,
    }),
  );
}
