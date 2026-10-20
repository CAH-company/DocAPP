"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, Card, Field, FormError } from "@/components/ui";
import { t } from "@/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (error) return setError(error.message ?? t("auth.invalidCredentials"));
    router.push(data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "/login/2fa" : "/dashboard");
    router.refresh();
  }

  return (
    <Card title="Logowanie">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <Field label="E-mail" name="email" type="email" autoComplete="username" required />
        <Field label="Hasło" name="password" type="password" autoComplete="current-password" required />
        <button className={btn + " w-full"} disabled={busy}>
          Zaloguj
        </button>
      </form>
      <Link href="/forgot-password" className="text-sm underline">
        Nie pamiętam hasła
      </Link>
    </Card>
  );
}
