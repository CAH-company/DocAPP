"use client";
import { useActionState } from "react";
import { btn, Field, FormError } from "@/components/ui";
import { inviteAction, type InviteState } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, { error: null, ok: false });
  return (
    <form action={action} className="max-w-md space-y-4">
      <FormError message={state.error} />
      {state.ok && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Zaproszenie wysłane.
        </p>
      )}
      <Field label="Imię i nazwisko" name="name" required minLength={2} maxLength={120} />
      <Field label="E-mail" name="email" type="email" required />
      <div className="space-y-1">
        <label htmlFor="role" className="block text-sm font-medium">
          Rola
        </label>
        <select id="role" name="role" className="block min-h-11 w-full rounded-md border border-slate-400 px-3 py-2" defaultValue="contractor">
          <option value="contractor">Zleceniobiorca</option>
          <option value="member">Pracownik firmy</option>
          <option value="accountant">Księgowa</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <button className={btn} disabled={pending}>
        Wyślij zaproszenie
      </button>
    </form>
  );
}
