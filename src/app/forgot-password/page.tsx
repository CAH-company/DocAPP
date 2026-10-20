"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, Card, Field } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true); // zawsze ten sam komunikat, żeby nie ujawniać, czy konto istnieje
  }

  return (
    <Card title="Reset hasła">
      {sent ? (
        <p role="status">Jeśli konto istnieje, wysłaliśmy wiadomość z linkiem do ustawienia nowego hasła.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="E-mail" name="email" type="email" autoComplete="username" required />
          <button className={btn + " w-full"}>Wyślij link</button>
        </form>
      )}
    </Card>
  );
}
