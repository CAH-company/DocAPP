"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, Card, Field, FormError } from "@/components/ui";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const newPassword = String(new FormData(e.currentTarget).get("password"));
    const { error } = await authClient.resetPassword({ newPassword, token });
    if (error) return setError("Link jest nieprawidłowy lub wygasł, albo hasło jest za krótkie (min. 12 znaków).");
    router.push("/login");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormError message={error} />
      <Field label="Nowe hasło (min. 12 znaków)" name="password" type="password" autoComplete="new-password" minLength={12} required />
      <button className={btn + " w-full"}>Ustaw hasło</button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card title="Nowe hasło">
      <Suspense>
        <ResetForm />
      </Suspense>
    </Card>
  );
}
