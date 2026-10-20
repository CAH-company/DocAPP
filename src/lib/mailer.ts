import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "./env";
import { hashValue } from "./redact";
import { logger } from "./logger";

let transport: Transporter | undefined;

function getTransport(): Transporter {
  if (transport) return transport;
  const env = getEnv();
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    // Odrzuć połączenie bez szyfrowania (SECURITY_RODO §4.1), chyba że jawnie dozwolone w dev/demo.
    requireTLS: !env.SMTP_ALLOW_INSECURE,
    ignoreTLS: env.SMTP_ALLOW_INSECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const env = getEnv();
  try {
    await getTransport().sendMail({ from: env.SMTP_FROM, ...msg });
    logger.info("mail.sent", { ref: hashValue(msg.to) });
  } catch (err) {
    logger.error("mail.failed", { reason: err instanceof Error ? err.message : "unknown", ref: hashValue(msg.to) });
    throw new Error("Nie udało się wysłać wiadomości");
  }
}
