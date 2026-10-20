import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";

/** Logi techniczne: JSON na stdout, bez danych osobowych (SECURITY_RODO §8). */
function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields ?? {}) as object) });
  (level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => write("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => write("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => write("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => write("error", m, f),
};
