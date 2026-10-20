import { describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

const valid = {
  NODE_ENV: "test",
  APP_URL: "https://example.test",
  DATABASE_URL: "postgres://app@db/app",
  MASTER_KEY: "a".repeat(64),
  AUTH_SECRET: "s".repeat(32),
  SMTP_HOST: "smtp.test",
  SMTP_FROM: "noreply@example.test",
} as unknown as NodeJS.ProcessEnv;

describe("getEnv", () => {
  it("przyjmuje poprawną konfigurację i ustawia domyślne", () => {
    const env = getEnv(valid);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.MAX_UPLOAD_MB).toBe(20);
  });

  it("odrzuca zły MASTER_KEY i nie ujawnia wartości w błędzie", () => {
    const bad = { ...valid, MASTER_KEY: "tajne-ale-za-krotkie" } as NodeJS.ProcessEnv;
    expect(() => getEnv(bad)).toThrow(/MASTER_KEY/);
    expect(() => getEnv(bad)).not.toThrow(/tajne-ale/);
  });

  it("w demo ogranicza upload do 5 MB", () => {
    const env = getEnv({ ...valid, DEMO_MODE: "true" } as NodeJS.ProcessEnv);
    expect(env.MAX_UPLOAD_MB).toBe(5);
  });

  it("blokuje niezaszyfrowany SMTP w produkcji", () => {
    const prod = { ...valid, NODE_ENV: "production", SMTP_ALLOW_INSECURE: "true" } as NodeJS.ProcessEnv;
    expect(() => getEnv(prod)).toThrow(/SMTP_ALLOW_INSECURE/);
  });
});
