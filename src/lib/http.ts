import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError } from "./authz";
import { getEnv } from "./env";
import { ScannerUnavailableError } from "./files/clamav";
import { FileRejectedError } from "./files/types";
import { logger } from "./logger";

/** Dodatkowa ochrona CSRF dla mutacji w API (poza SameSite=Lax): Origin musi zgadzać się z APP_URL. */
export function sameOriginOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  return origin === new URL(getEnv().APP_URL).origin;
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Ogólne komunikaty + ID błędu; szczegóły tylko w logach (SECURITY_RODO §7). */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) return json({ error: "forbidden" }, 403);
  if (err instanceof ZodError) return json({ error: "invalid_input" }, 400);
  if (err instanceof FileRejectedError) {
    const status = { type: 415, size: 413, empty: 400, infected: 422, related: 404 }[err.reason];
    return json({ error: `file_${err.reason}` }, status);
  }
  if (err instanceof ScannerUnavailableError) {
    logger.error("scanner.unavailable", { reason: err.message });
    return json({ error: "scanner_unavailable" }, 503);
  }
  const errorId = crypto.randomUUID();
  logger.error("request.failed", { errorId, reason: err instanceof Error ? err.message : "unknown" });
  return json({ error: "internal", errorId }, 500);
}
