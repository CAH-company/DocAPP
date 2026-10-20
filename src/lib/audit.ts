import { auditLog } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { redact } from "./redact";

export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.password_changed",
  "auth.password_reset_requested",
  "auth.2fa_enabled",
  "auth.2fa_disabled",
  "auth.reauth_failed",
  "user.invited",
  "user.invitation_accepted",
  "user.role_changed",
  "user.disabled",
  "contract.created",
  "contract.updated",
  "contract.accepted",
  "statement.created",
  "statement.accepted",
  "bill.created",
  "bill.sent",
  "bill.accepted",
  "bill.rejected",
  "bill.approved",
  "bill.exported",
  "file.uploaded",
  "file.downloaded",
  "file.deleted",
  "file.infected",
  "export.run",
  "export.person_data",
  "person.erased",
  "retention.run",
  "settings.changed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  orgId?: string | null;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Wyłącznie identyfikatory i parametry techniczne. Pola typu email/name są hashowane przez redact(). */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Dopisuje wpis w ramach transakcji wywołującego (zmiana + audyt są atomowe). */
export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: e.orgId ?? null,
    actorUserId: e.actorUserId ?? null,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    metadata: redact(e.metadata ?? {}) as Record<string, unknown>,
    ip: e.ip ?? null,
  });
}
