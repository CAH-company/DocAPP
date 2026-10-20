import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAudit, type AuditAction } from "./audit";
import { getEnv } from "./env";
import { logger } from "./logger";
import { sendMail } from "./mailer";
import { t } from "@/i18n";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const LOGIN_PATHS = ["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code"];

function clientIp(headers: Headers | undefined): string | null {
  return headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** Wpis audytu poza sesją aplikacji (logowanie). Org ustalamy z członkostwa, jeśli użytkownik jest znany. */
export async function auditAuth(action: AuditAction, userId: string | null, ip: string | null, metadata: Record<string, unknown> = {}) {
  try {
    if (!userId) {
      await withTenant({}, (tx) => writeAudit(tx, { action, ip, metadata }));
      return;
    }
    const orgId = await withTenant({ userId }, async (tx) => {
      const [m] = await tx.select({ orgId: schema.memberships.orgId }).from(schema.memberships).where(eq(schema.memberships.userId, userId)).limit(1);
      return m?.orgId;
    });
    await withTenant({ orgId, userId }, (tx) => writeAudit(tx, { action, orgId, actorUserId: userId, entityType: "user", entityId: userId, ip, metadata }));
  } catch (err) {
    // Audyt nie może wywrócić logowania, ale awarię trzeba zauważyć w logach technicznych.
    logger.error("audit.write_failed", { action, reason: err instanceof Error ? err.message : "unknown" });
  }
}

async function findUserByEmail(email: string) {
  const [u] = await getDb().select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`).limit(1);
  return u;
}

function build() {
  const env = getEnv();
  const prod = env.NODE_ENV === "production";
  const loginRule = { window: LOCK_MINUTES * 60, max: env.DEMO_MODE ? 3 : 5 };

  return betterAuth({
    appName: t("app.name"),
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
        rateLimit: schema.rateLimits,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: prod,
      cookiePrefix: "obieg",
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // konta powstają tylko przez zaproszenia i CLI create-admin
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await auditAuth("auth.password_reset_requested", user.id, null);
        await sendMail({ to: user.email, subject: t("mail.reset.subject"), text: `${t("mail.reset.body")}\n\n${url}\n\n${t("mail.reset.ignore")}` });
      },
    },
    verification: { storeIdentifier: "hashed" },
    session: {
      expiresIn: 7 * 24 * 60 * 60, // limit bezwzględny 7 dni
      // Bez automatycznego odświeżania: wygaśnięcie jest bezwzględne, a updatedAt (aktywność)
      // aktualizuje session.ts po sprawdzeniu limitu bezczynności.
      disableSessionRefresh: true,
      cookieCache: { enabled: false }, // unieważnienie sesji działa natychmiast
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: env.DEMO_MODE ? 60 : 120,
      customRules: {
        "/sign-in/email": loginRule,
        "/two-factor/verify-totp": { window: LOCK_MINUTES * 60, max: 10 },
        "/two-factor/verify-backup-code": { window: LOCK_MINUTES * 60, max: 10 },
        "/request-password-reset": { window: LOCK_MINUTES * 60, max: 5 },
        "/reset-password": { window: LOCK_MINUTES * 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        const user = await findUserByEmail(email);
        if (!user) return;
        if (user.status === "disabled") {
          throw new APIError("UNAUTHORIZED", { message: t("auth.invalidCredentials") });
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new APIError("TOO_MANY_REQUESTS", { message: t("auth.locked") });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ip = clientIp(ctx.request?.headers ?? ctx.headers);
        if (ctx.path === "/sign-in/email" && ctx.context.returned instanceof APIError) {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          const user = typeof email === "string" ? await findUserByEmail(email) : undefined;
          if (user) {
            const failed = user.failedLoginCount + 1;
            const lock = failed >= MAX_FAILED_LOGINS;
            await getDb()
              .update(schema.users)
              .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil })
              .where(eq(schema.users.id, user.id));
          }
          await auditAuth("auth.login_failed", user?.id ?? null, ip, { locked: Boolean(user && user.failedLoginCount + 1 >= MAX_FAILED_LOGINS) });
          return;
        }
        const session = ctx.context.newSession;
        if (session && LOGIN_PATHS.includes(ctx.path)) {
          await getDb()
            .update(schema.users)
            .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
            .where(eq(schema.users.id, session.user.id));
          await auditAuth("auth.login", session.user.id, ip);
        }
        if (ctx.path === "/sign-out") await auditAuth("auth.logout", ctx.context.session?.user.id ?? null, ip);
      }),
    },
    plugins: [
      twoFactor({ issuer: t("app.name") }),
      nextCookies(), // musi być ostatni
    ],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __auth?: Auth };

/** Leniwe tworzenie: `next build` nie ma sekretów środowiska. */
export function getAuth(): Auth {
  g.__auth ??= build();
  return g.__auth;
}
