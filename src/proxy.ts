import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login/, /^\/forgot-password/, /^\/reset-password/, /^\/invite\//, /^\/api\/auth\//, /^\/api\/health$/, /^\/robots\.txt$/];

/**
 * 1) nagłówki bezpieczeństwa z CSP i nonce (SECURITY_RODO §7),
 * 2) szybkie przekierowanie niezalogowanych (optymistyczne: pełna kontrola jest po stronie serwera w requireAuth()).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const dev = process.env.NODE_ENV === "development";

  if (!PUBLIC.some((re) => re.test(pathname)) && !getSessionCookie(req, { cookiePrefix: "obieg" })) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // wyjątek opisany w docs/SECURITY_EXCEPTIONS.md
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (process.env.DEMO_MODE === "true") res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
