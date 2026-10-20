"use client";
import { useActionState } from "react";
import { btn, Field, FormError } from "@/components/ui";
import { acceptInvitationAction, type ActionState } from "./actions";

export function AcceptForm({ token, clause, clauseHash }: { token: string; clause: string; clauseHash: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptInvitationAction, { error: null });

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <input type="hidden" name="token" value={token} />
      <Field label="Hasło (min. 12 znaków)" name="password" type="password" autoComplete="new-password" minLength={12} required />
      <section aria-labelledby="clause-h" className="rounded-md border border-slate-300 p-3 text-sm">
        <h2 id="clause-h" className="mb-1 font-medium">
          Klauzula informacyjna RODO
        </h2>
        <p>{clause}</p>
        <p className="mt-2 text-xs text-slate-600">Wersja: {clauseHash.slice(0, 8)}</p>
      </section>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="clauseAccepted" required className="mt-1 h-5 w-5" />
        Zapoznałem(-am) się z klauzulą informacyjną.
      </label>
      <button className={btn + " w-full"} disabled={pending}>
        Ustaw hasło
      </button>
    </form>
  );
}
