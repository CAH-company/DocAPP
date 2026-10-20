"use client";

// Użytkownik widzi ogólny komunikat i ID błędu; szczegóły są tylko w logach serwera (SECURITY_RODO §7).
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Coś poszło nie tak</h1>
      <p className="mt-2">Spróbuj ponownie. Jeśli problem się powtarza, podaj administratorowi ID błędu.</p>
      {error.digest && <p className="mt-4 font-mono text-sm">ID błędu: {error.digest}</p>}
    </main>
  );
}
