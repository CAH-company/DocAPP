"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, Card, Field, FormError } from "@/components/ui";

export default function Setup2faPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || !("totpURI" in data)) return setError("Nie udało się potwierdzić hasła.");
    setQr(await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }));
    setCodes(data.backupCodes);
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return setError("Nieprawidłowy kod.");
    setDone(true);
  }

  if (done) {
    return (
      <Card title="Weryfikacja dwuetapowa włączona">
        <button
          className={btn}
          onClick={() => {
            router.push("/dashboard");
            router.refresh();
          }}
        >
          Przejdź do systemu
        </button>
      </Card>
    );
  }

  return (
    <Card title="Włącz weryfikację dwuetapową">
      <p>Dla Twojej roli weryfikacja dwuetapowa jest obowiązkowa.</p>
      <FormError message={error} />
      {!qr ? (
        <form onSubmit={start} className="space-y-4">
          <Field label="Potwierdź hasłem" name="password" type="password" autoComplete="current-password" required />
          <button className={btn + " w-full"}>Dalej</button>
        </form>
      ) : (
        <div className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Kod QR do aplikacji uwierzytelniającej" width={220} height={220} />
          <div>
            <p className="text-sm font-medium">Kody zapasowe (zapisz w bezpiecznym miejscu, pokazujemy je raz):</p>
            <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <form onSubmit={confirm} className="space-y-4">
            <Field label="Kod z aplikacji" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            <button className={btn + " w-full"}>Potwierdź</button>
          </form>
        </div>
      )}
    </Card>
  );
}
