import { createHash, randomBytes } from "node:crypto";

/** Token ≥ 256 bitów, URL-safe. W bazie ląduje wyłącznie jego hash. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
