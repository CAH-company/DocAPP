"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, Card, Field, FormError } from "@/components/ui";

export default function TwoFactorPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    const { error } = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
    if (error) return setError("Nieprawidłowy kod.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card title="Kod weryfikacyjny">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field
          label={backup ? "Kod zapasowy" : "Kod z aplikacji uwierzytelniającej"}
          name="code"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
        />
        <button className={btn + " w-full"}>Potwierdź</button>
      </form>
      <button type="button" className="text-sm underline" onClick={() => setBackup(!backup)}>
        {backup ? "Użyj kodu z aplikacji" : "Użyj kodu zapasowego"}
      </button>
    </Card>
  );
}
