import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform, pipeline } from "node:stream";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { bills, contracts, contractStatements, files } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { writeAudit } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { createDecryptStream, createEncryptStream } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { getScanner } from "@/lib/files/clamav";
import { getStorage } from "@/lib/files/storage";
import { DEMO_KINDS, detectKind, FileRejectedError, KINDS, PROD_KINDS } from "@/lib/files/types";
import { getKeyring } from "@/lib/keyring";
import { logger } from "@/lib/logger";
import type { AuthContext } from "@/lib/session";

export const RELATED_TYPES = ["contract", "bill", "statement", "profile", "document"] as const;
export type RelatedType = (typeof RELATED_TYPES)[number];

export const uploadMeta = z.strictObject({
  relatedType: z.enum(RELATED_TYPES),
  relatedId: z.uuid().optional(),
});

const noop = () => {};
const tenant = (ctx: AuthContext) => ({ orgId: ctx.orgId, userId: ctx.userId, role: ctx.role });

/** Czy powiązany obiekt istnieje i jest widoczny dla użytkownika (RLS odcina cudze). */
async function relatedVisible(tx: Tx, type: RelatedType, id: string | undefined): Promise<boolean> {
  if (type === "profile" || type === "document") return id === undefined;
  if (!id) return false;
  const table = { contract: contracts, bill: bills, statement: contractStatements }[type];
  const rows = await tx.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  return rows.length === 1;
}

export interface UploadedFile {
  id: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

export async function uploadFile(ctx: AuthContext, file: File, metaRaw: unknown, ip: string | null): Promise<UploadedFile> {
  assertCan(ctx.role, "files.upload");
  const meta = uploadMeta.parse(metaRaw);
  const env = getEnv();

  if (file.size === 0) throw new FileRejectedError("empty");
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new FileRejectedError("size");

  const head = Buffer.from(await file.slice(0, 16).arrayBuffer());
  const kind = detectKind(head, file.type, file.name, env.DEMO_MODE ? DEMO_KINDS : PROD_KINDS);

  if (!(await withTenant(tenant(ctx), (tx) => relatedVisible(tx, meta.relatedType, meta.relatedId)))) {
    throw new FileRejectedError("related");
  }

  // 1) Skan ClamAV PRZED zapisem. Niedostępny skaner rzuca ScannerUnavailableError (fail closed).
  // CLAMAV_ENABLED=false: tylko środowisko testowe; plik dostaje status "skipped", a nie "clean".
  const scanEnabled = env.CLAMAV_ENABLED;
  if (!scanEnabled) logger.warn("files.scan_skipped", { reason: "CLAMAV_ENABLED=false" });
  const verdict = scanEnabled ? await getScanner().scan(Readable.fromWeb(file.stream() as never)) : { clean: true as const };
  if (!verdict.clean) {
    await withTenant(tenant(ctx), (tx) =>
      writeAudit(tx, { action: "file.infected", orgId: ctx.orgId, actorUserId: ctx.userId, metadata: { signature: verdict.signature, size: file.size }, ip }),
    );
    throw new FileRejectedError("infected");
  }

  // 2) Szyfrowanie strumieniowe i zapis pod losowym kluczem. Hash jawnego pliku liczymy w locie.
  const hash = createHash("sha256");
  const hashing = new Transform({
    transform(chunk, _e, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const { stream: encrypt, keyId } = createEncryptStream(getKeyring());
  const cipherOut = pipeline(Readable.fromWeb(file.stream() as never), hashing, encrypt, noop);
  const storageKey = randomUUID();
  await getStorage().put(storageKey, cipherOut as unknown as Readable);
  const sha256 = hash.digest("hex");

  const id = randomUUID();
  const mime = KINDS[kind].mime;
  try {
    await withTenant(tenant(ctx), async (tx) => {
      await tx.insert(files).values({
        id,
        orgId: ctx.orgId,
        ownerUserId: ctx.userId,
        relatedType: meta.relatedType,
        relatedId: meta.relatedId ?? null,
        originalName: file.name.slice(0, 255),
        mime,
        sizeBytes: file.size,
        sha256Plain: sha256,
        storageKey,
        keyId,
        scanStatus: scanEnabled ? "clean" : "skipped",
        uploadedBy: ctx.userId,
      });
      await writeAudit(tx, { action: "file.uploaded", orgId: ctx.orgId, actorUserId: ctx.userId, entityType: "file", entityId: id, metadata: { related_type: meta.relatedType, size: file.size, kind, scan: scanEnabled ? "clean" : "skipped" }, ip });
    });
  } catch (e) {
    await getStorage().delete(storageKey).catch(() => logger.error("files.orphan_blob", { storageKey }));
    throw e;
  }
  return { id, originalName: file.name, mime, sizeBytes: file.size, sha256 };
}

export interface OpenedFile {
  stream: Readable;
  mime: string;
  originalName: string;
  sizeBytes: number;
  inline: boolean;
}

/** Zwraca odszyfrowany strumień albo null, gdy plik nie istnieje LUB użytkownik go nie widzi (RLS) – bez rozróżnienia. */
export async function openFile(ctx: AuthContext, id: string, ip: string | null, wantInline = false): Promise<OpenedFile | null> {
  assertCan(ctx.role, "files.read");
  const row = await withTenant(tenant(ctx), async (tx) => {
    const [f] = await tx.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
    if (!f || (f.scanStatus !== "clean" && f.scanStatus !== "skipped")) return null;
    await writeAudit(tx, { action: "file.downloaded", orgId: ctx.orgId, actorUserId: ctx.userId, entityType: "file", entityId: f.id, ip });
    return f;
  });
  if (!row) return null;

  const raw = await getStorage().get(row.storageKey);
  const stream = pipeline(raw, createDecryptStream(getKeyring()), noop) as unknown as Readable;
  const kind = (Object.values(KINDS).find((k) => k.mime === row.mime));
  return { stream, mime: row.mime, originalName: row.originalName, sizeBytes: row.sizeBytes, inline: wantInline && Boolean(kind?.inline) };
}

export async function deleteFile(ctx: AuthContext, id: string, ip: string | null): Promise<boolean> {
  assertCan(ctx.role, "files.delete");
  const storageKey = await withTenant(tenant(ctx), async (tx) => {
    const [f] = await tx.select({ id: files.id, storageKey: files.storageKey }).from(files).where(and(eq(files.id, id), isNull(files.deletedAt))).limit(1);
    if (!f) return null;
    const updated = await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id)).returning({ id: files.id });
    if (updated.length !== 1) return null;
    await writeAudit(tx, { action: "file.deleted", orgId: ctx.orgId, actorUserId: ctx.userId, entityType: "file", entityId: id, ip });
    return f.storageKey;
  });
  if (!storageKey) return false;
  // Usunięcie z magazynu (nie tylko flaga). Gdyby się nie udało, sierotę sprzątnie job retencji (E5).
  await getStorage().delete(storageKey).catch((e) => logger.error("files.delete_blob_failed", { storageKey, reason: String(e) }));
  return true;
}
