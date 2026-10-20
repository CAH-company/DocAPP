import { createHash } from "node:crypto";

const SECRET_KEYS = /^(password|passwd|token|authorization|cookie|set-cookie|secret|otp|code|iban|account|bank.*)$/i;
const PII_KEYS = /^(email|name|first.?name|last.?name|address|phone|pesel)$/i;

export function hashValue(v: string): string {
  return createHash("sha256").update(v.toLowerCase()).digest("hex").slice(0, 12);
}

/** Maskuje sekrety, a pola osobowe (email) zamienia na krótki hash, żeby dało się korelować wpisy. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (PII_KEYS.test(k)) out[k] = typeof v === "string" ? `h:${hashValue(v)}` : "[redacted]";
    else out[k] = redact(v, depth + 1);
  }
  return out;
}
