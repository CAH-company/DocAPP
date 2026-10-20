import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { redact } from "@/lib/redact";
import { generateToken, hashToken } from "@/lib/tokens";

describe("proxy: nagłówki i dostęp", () => {
  it("niezalogowany jest przekierowany z chronionej strony", () => {
    const res = proxy(new NextRequest("https://app.test/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login");
  });

  it("strony publiczne dostają komplet nagłówków i CSP z nonce", () => {
    const res = proxy(new NextRequest("https://app.test/login"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[\w+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("nonce jest inny przy każdym żądaniu", () => {
    const a = proxy(new NextRequest("https://app.test/login")).headers.get("content-security-policy");
    const b = proxy(new NextRequest("https://app.test/login")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("endpoint health i auth nie wymagają sesji", () => {
    expect(proxy(new NextRequest("https://app.test/api/health")).status).toBe(200);
    expect(proxy(new NextRequest("https://app.test/api/auth/get-session")).status).toBe(200);
  });
});

describe("redakcja logów", () => {
  it("maskuje sekrety i hashuje email/nazwiska", () => {
    const out = JSON.stringify(
      redact({ password: "tajne", token: "abc", authorization: "Bearer x", email: "jan@firma.pl", name: "Jan Kowalski", nested: { iban: "PL61", id: "uuid-1" } }),
    );
    expect(out).not.toContain("tajne");
    expect(out).not.toContain("Bearer");
    expect(out).not.toContain("jan@firma.pl");
    expect(out).not.toContain("Kowalski");
    expect(out).not.toContain("PL61");
    expect(out).toContain("uuid-1");
  });
});

describe("tokeny", () => {
  it("mają ≥ 256 bitów entropii i nie są odwracalne z hasha", () => {
    const t = generateToken();
    expect(Buffer.from(t, "base64url").length).toBeGreaterThanOrEqual(32);
    expect(hashToken(t)).not.toContain(t);
    expect(generateToken()).not.toBe(t);
  });
});
