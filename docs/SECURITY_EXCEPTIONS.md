# Odstępstwa od wymagań [SHOULD] i decyzje projektowe

Wymagania [MUST] z `SECURITY_RODO.md` nie mają tu wyjątków. Lista dotyczy [SHOULD] oraz miejsc, gdzie wybrano wariant inny niż w treści specyfikacji.

| # | Wymaganie | Decyzja | Uzasadnienie | Do kiedy |
|---|---|---|---|---|
| 1 | CSP bez `unsafe-inline` (§7) | `style-src 'self' 'unsafe-inline'`; skrypty z nonce i `strict-dynamic` | Next.js i biblioteki UI wstawiają style inline; nonce dla stylów rozwala część renderowania. Ryzyko XSS przez CSS jest niskie przy skryptach pod nonce. | Przegląd w E7 |
| 2 | Sekret TOTP szyfrowany kluczem aplikacji (§4.2 `totp_secret_enc`) | Sekret TOTP trzyma Better Auth (`two_factors.secret`), szyfrowany kluczem pochodnym `AUTH_SECRET` | Własna kolumna dublowałaby mechanizm biblioteki. `AUTH_SECRET` jest generowany przez `install.sh` i nie trafia do bazy ani repo. | Ponowna ocena przy rotacji kluczy (E7) |
| 3 | Argon2id dla haseł (§4.4) | Domyślny algorytm Better Auth (scrypt) | Dopuszczone w specyfikacji ("scrypt, jeśli to bezpieczny domyślny algorytm biblioteki"). | - |
| 4 | Lista haseł skompromitowanych lokalnie [SHOULD] | Niezaimplementowane | Wymaga lokalnej listy (np. top 100k); minimum 12 znaków obowiązuje. | E7 |
| 5 | Tokeny resetu hasła w bazie tylko jako hash (§4.4) | `verification.storeIdentifier: "hashed"` | Realizowane przez bibliotekę, zweryfikować w E7 testem na bazie. | E7 |
| 6 | RLS na tabeli `users` | Brak | Better Auth czyta `users` przed ustaleniem kontekstu (logowanie, sesja). Dostęp do tej tabeli wyłącznie przez warstwę aplikacji. | Rozważyć widok z RLS w E7 |
| 7 | Audit log append-only vs retencja 5 lat | Trigger blokuje DELETE także właścicielowi | Job retencji (E5) potrzebuje kontrolowanego wyjątku (osobna rola lub `SECURITY DEFINER` z jawnym logiem). Decyzja właściciela produktu. | E5 |
| 8 | Ponowne uwierzytelnienie | Hasło; limit prób wspólny z logowaniem (5 prób, blokada 15 min) | Spełnia §5. Kod jednorazowy z maila jako alternatywa dojdzie w E4 przy akceptacji dokumentów. | E4 |
| 9 | Skan ClamAV przed zapisem (§7, MUST) | Wyłączalny przez `CLAMAV_ENABLED=false` **wyłącznie na serwerze testowym**; pliki oznaczane `skipped` | Brak RAM-u na serwerze testowym. Na produkcji [MUST] obowiązuje bez wyjątku. | Przed pierwszym klientem, patrz `docs/TODO.md` |
