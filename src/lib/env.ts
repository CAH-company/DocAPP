import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const hex32 = z.string().regex(/^[0-9a-f]{64}$/i, "Wymagane 32 bajty w hex (64 znaki)");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DEMO_MODE: bool,
  FEATURE_PESEL: bool,

  DATABASE_URL: z.string().min(1), // konto aplikacji, bez superusera
  MASTER_KEY: hex32, // KEK, 32 bajty
  MASTER_KEY_ID: z.string().min(1).default("k1"),
  MASTER_KEYS_PREVIOUS: z.string().optional(), // rotacja: "k0:<hex64>,..." (tylko do odczytu starych danych)
  AUTH_SECRET: z.string().min(32),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("/data/files"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("eu-central-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  // false = wersja testowa bez antywirusa (docs/TODO.md). Na produkcji MUSI być true.
  CLAMAV_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  CLAMAV_HOST: z.string().default("clamav"),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1),
  SMTP_ALLOW_INSECURE: bool,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Waliduje zmienne środowiskowe przy pierwszym użyciu; błąd listuje nazwy, nie wartości. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Nieprawidłowa konfiguracja środowiska:\n- ${names.join("\n- ")}`);
  }
  const env = parsed.data;
  // Wyjątek: wewnętrzny Mailpit (kontener bez wyjścia na zewnątrz) w instalacji testowej/demo.
  if (env.NODE_ENV === "production" && env.SMTP_ALLOW_INSECURE && env.SMTP_HOST !== "mailpit") {
    throw new Error("SMTP_ALLOW_INSECURE jest niedozwolone w produkcji");
  }
  if (env.STORAGE_DRIVER === "s3" && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 wymaga S3_BUCKET, S3_ACCESS_KEY_ID i S3_SECRET_ACCESS_KEY");
  }
  if (env.DEMO_MODE) env.MAX_UPLOAD_MB = Math.min(env.MAX_UPLOAD_MB, 5);
  if (source === process.env) cached = env;
  return env;
}
