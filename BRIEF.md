# BRIEF — System obiegu umów zlecenia i rachunków (wersja DEMO / F1)

> Dokument dla Claude Code. Przeczytaj w całości **razem z `SECURITY_RODO.md` i `MAINTENANCE.md`** przed napisaniem pierwszej linijki kodu. Te trzy pliki to jedna specyfikacja. Przy sprzeczności pierwszeństwo ma `SECURITY_RODO.md`.
>
> Pracuj etapami (sekcja 10). Po każdym etapie zatrzymaj się, podsumuj, co powstało, i wypisz otwarte pytania.
> Gdy coś jest niejasne, zwłaszcza w kwestiach prawnych, podatkowych lub bezpieczeństwa, **zapytaj, zamiast zgadywać**.

---

## 1. Produkt w jednym akapicie

Aplikacja webowa (mobile-first) dla polskich firm, które współpracują z ludźmi na **umowach zlecenia**. Firma prowadzi w niej umowy, **oświadczenia do celów ZUS** i **rachunki miesięczne**. Zleceniobiorca ma własny portal, w którym widzi swoje umowy, akceptuje rachunki z telefonu i uzupełnia oświadczenia. Księgowa dostaje zatwierdzone rachunki do eksportu. Obie strony widzą, co jest do zrobienia i co kiedy wygasa.

## 2. Model wdrożenia (KLUCZOWE)

- Produkt jest **instalowany u klienta**: na jego VPS lub serwerze, jako paczka **Docker Compose**. Nie ma centralnego SaaS-a i PAH nie przechowuje danych klientów.
- Jedna instalacja = jedna firma-klient (model danych wspiera wiele organizacji na przyszłość, np. biuro rachunkowe, ale UI F1 zakłada jedną).
- Aplikacja musi działać **w pełni bez połączenia z infrastrukturą PAH**. Jedyny wyjątek to opcjonalny, wyłączalny agent zdrowia, który wysyła wyłącznie metryki techniczne bez danych osobowych (patrz `MAINTENANCE.md`).
- **Demo** to ta sama paczka uruchomiona na serwerze PAH z `DEMO_MODE=true` (sekcja 9).

## 3. Zakres F1 (to budujemy teraz)

**W zakresie:**
- instalacja jednym skryptem, HTTPS, konto pierwszego admina;
- organizacja, zapraszanie użytkowników mailem (SMTP), role;
- profil zleceniobiorcy (minimalny zestaw danych, sekcja 6);
- umowy: ręczne wprowadzenie + załączony plik (PDF/DOCX/skan), statusy, daty;
- oświadczenia ZUS w formularzu krok po kroku, wygenerowany PDF i akceptacja;
- rachunki miesięczne: tworzone ręcznie lub przyciskiem „utwórz rachunki za miesiąc” dla aktywnych umów, wysłanie do akceptacji, akceptacja przez zleceniobiorcę, zatwierdzenie przez firmę, PDF;
- dashboard firmy z sekcjami „do zrobienia”: rachunki do zatwierdzenia, umowy wygasające w 30 dni, oświadczenia starsze niż 12 mies., zleceniobiorca kończący 26 lat przy statusie studenta. **Liczone na żywo przy wejściu, bez wysyłki powiadomień;**
- portal zleceniobiorcy: „Do zrobienia”, umowy, rachunki, dokumenty;
- widok księgowej: zatwierdzone rachunki per miesiąc, eksport CSV + ZIP z PDF;
- audit log, eksport danych osoby, usuwanie/anonimizacja wg retencji;
- wbudowane backupy i skrypty serwisowe (`MAINTENANCE.md`);
- tryb DEMO.

**Poza zakresem F1 (F2+, nie implementuj, ale nie blokuj architekturą):**
- pobieranie dokumentów z maila (inbound) i klasyfikacja AI;
- automatyczne powiadomienia mailowe/push i crony przypomnień;
- ekstrakcja danych z umów przez LLM;
- generowanie umów z szablonów, kalkulator ZUS/PIT;
- integracje e-podpisu (Autenti/SIGNIUS), eksport do programów księgowych;
- centralna aplikacja zleceniobiorcy łącząca wiele instancji (przygotuj czyste, wersjonowane API `/api/v1`, nic więcej);
- wielojęzyczność (ale wszystkie teksty od początku w plikach i18n, PL domyślnie).

**MVP NIE liczy składek ZUS ani zaliczki PIT.** Rachunek zawiera kwotę brutto. Obliczenia robi księgowa lub program kadrowy. W UI i na PDF ma być widoczna informacja o tym.

## 4. Stack

| Warstwa | Wybór | Uwagi |
|---|---|---|
| Aplikacja | **Next.js (App Router) + TypeScript**, `output: "standalone"` | jeden kontener `app` |
| UI | Tailwind + shadcn/ui | mobile-first, WCAG 2.1 AA jako cel |
| ORM / migracje | **Drizzle** | migracje SQL w repo, uruchamiane przy starcie przez osobny krok `migrate` |
| Baza | **PostgreSQL 17** (oficjalny obraz) | niewystawiona poza sieć Dockera |
| Auth | **Better Auth** (sprawdź aktualną wersję i stabilność; alternatywa: Auth.js) | email+hasło, magic link, **TOTP 2FA** (obowiązkowe dla admin/accountant) |
| Pliki | warstwa `StorageDriver` z dwoma driverami: **lokalny wolumen** (domyślny) i **S3-compatible** (opcjonalny) | szyfrowanie po stronie aplikacji (patrz `SECURITY_RODO.md`) |
| PDF | `pdf-lib` lub `@react-pdf/renderer` | generowanie rachunków i oświadczeń |
| Antywirus | kontener **ClamAV** (clamd) | każdy upload skanowany przed zapisem |
| Proxy / TLS | **Caddy** | automatyczny Let's Encrypt, nagłówki bezpieczeństwa |
| Mail | SMTP z `.env` | w demo i dev: **Mailpit** (przechwytuje maile) |
| Backup | **restic** + `pg_dump`, w kontenerze `backup` z harmonogramem (supercronic) | patrz `MAINTENANCE.md` |
| Walidacja | **zod** na każdym wejściu (formularze, API, env) | |
| Testy | Vitest (logika, uprawnienia), Playwright (krytyczne flow) | |
| CI | GitHub Actions: lint, typecheck, testy, build obrazu, **skan Trivy**, `npm audit` | obrazy do GHCR, tagi semver |

Nie używaj usług chmurowych wymagających konta PAH (Supabase, Vercel, Firebase itp.) ani zewnętrznych CDN dla fontów/skryptów w aplikacji klienta (fonty self-hosted).

## 5. Role i uprawnienia

| Rola | Może |
|---|---|
| `admin` | wszystko w organizacji: użytkownicy, ustawienia, retencja, umowy, rachunki, eksporty, audit log |
| `member` | umowy, rachunki, dokumenty, zleceniobiorcy; bez ustawień, użytkowników i audit logu |
| `accountant` | read-only: zatwierdzone rachunki, umowy, oświadczenia; eksport |
| `contractor` | wyłącznie własne dane: profil, umowy, oświadczenia, rachunki, dokumenty |

- Uprawnienia sprawdzane **po stronie serwera** w jednej warstwie (`authz`), nigdy tylko w UI.
- Każde zapytanie do danych przechodzi przez warstwę repozytoriów, która wymusza `org_id` i (dla contractor) `contractor_id`. Dodatkowo **Postgres RLS** jako druga linia obrony (`SET app.current_org`, `app.current_user`).
- Testy autoryzacji dla każdej roli i każdego endpointu (macierz w testach).

## 6. Model danych (szkic, dopracuj w migracjach)

```
organizations        id, name, nip, address, settings jsonb (retencja, kto wpisuje godziny itd.), created_at
users                id, email (unique), name, password_hash, totp_secret_enc, status, last_login_at, created_at
memberships          user_id, org_id, role, status(invited|active|disabled), invited_by, created_at

contractor_profiles  user_id, org_id,
                     address,
                     bank_account_enc, bank_account_last4,
                     birth_date            -- potrzebne do alertu "26 lat"
                     -- PESEL: NIE ZBIERAMY w F1 (patrz SECURITY_RODO.md §3)

contracts            id, org_id, contractor_id, number, title, scope,
                     rate_type(hourly|monthly|fixed), rate_amount_gross, currency,
                     start_date, end_date nullable,
                     status(draft|pending_acceptance|active|expired|terminated),
                     source(uploaded|external), file_id nullable,
                     accepted_by_contractor_at, created_by, created_at, updated_at

contract_statements  id, contract_id, valid_from,
                     is_student_under_26, student_status_valid_until nullable,
                     has_other_civil_contract, other_contract_note,
                     has_employment_contract, employment_pay_at_least_min_wage nullable,
                     has_business_activity, is_retired_or_pensioner,
                     wants_voluntary_sickness_insurance,
                     accepted_at, pdf_file_id, created_at
                     -- treść pytań oświadczenia: do weryfikacji z księgową; trzymaj w configu, nie hardkoduj

bills                id, contract_id, org_id, period (YYYY-MM), hours nullable, gross_amount, note,
                     status(draft|sent|accepted|approved|rejected|exported),
                     sent_at, accepted_at, approved_at, approved_by, rejected_reason,
                     pdf_file_id, pdf_sha256, created_at

files                id, org_id, owner_user_id nullable, related_type, related_id,
                     original_name, mime, size_bytes, sha256_plain,
                     storage_key, key_id, encryption_alg, scan_status(pending|clean|infected),
                     uploaded_by, created_at, deleted_at nullable

acceptances          id, org_id, user_id, subject_type(contract|bill|statement), subject_id,
                     document_sha256, method(click+reauth), ip, user_agent, created_at
                     -- dowód akceptacji: hash dokumentu w chwili akceptacji

audit_log            id, org_id, actor_user_id, action, entity_type, entity_id,
                     metadata jsonb (BEZ danych osobowych w treści), ip, created_at
                     -- append-only: trigger blokuje UPDATE/DELETE

retention_jobs       id, org_id, run_at, entity_type, affected_count, status
```

Zasady:
- Kwoty jako `numeric(12,2)`, nigdy float.
- Strefa czasowa: przechowuj UTC, wyświetlaj Europe/Warsaw.
- Soft delete tylko tam, gdzie wymaga tego retencja. Usunięcie ostateczne usuwa też plik z magazynu.
- Seed (osobny dla dev i demo): 1 firma, 2 użytkowników firmy, 5 zleceniobiorców z różnymi przypadkami (student < 26 kończący 26 lat za 20 dni, osoba z etatem, umowa wygasająca za 7 dni, rachunek czekający na akceptację, rachunek odrzucony).

## 7. Kluczowe flow

### 7.1 Instalacja
`./install.sh` (patrz `MAINTENANCE.md`):
1. sprawdza wymagania;
2. pyta o domenę, email admina i dane SMTP;
3. **generuje sekrety i klucze** (nie zapisuje ich w repo);
4. stawia kontenery;
5. uruchamia migracje;
6. tworzy admina z wymuszeniem ustawienia 2FA przy pierwszym logowaniu.

### 7.2 Zaproszenie zleceniobiorcy
1. Admin lub member dodaje osobę (imię, nazwisko, email) → mail z linkiem (jednorazowy token, ważny 72 h, przechowywany jako hash).
2. Zleceniobiorca ustawia hasło, akceptuje **klauzulę informacyjną RODO** wybranej firmy (treść konfigurowalna przez admina, z domyślnym szablonem do uzupełnienia) i uzupełnia profil.
3. Wypełnia oświadczenie → PDF → akceptacja (sekcja 7.5).

### 7.3 Umowa
- Firma wprowadza dane umowy i (opcjonalnie) wgrywa plik → skan AV → szyfrowanie → zapis.
- Opcjonalnie wysyła do akceptacji zleceniobiorcy (dla umów zawartych poza systemem może oznaczyć „podpisana poza systemem”).
- Status `expired` wyliczany z `end_date`. Przy wejściu na dashboard nie ma potrzeby crona, ale dodaj lekki job dzienny w kontenerze `app` lub `backup`, który aktualizuje statusy.

### 7.4 Rachunek miesięczny
1. „Utwórz rachunki za [miesiąc]” → szkic dla każdej aktywnej umowy w danym okresie.
2. Firma (lub zleceniobiorca, zależnie od `settings.hours_entered_by`) wpisuje godziny lub kwotę.
3. „Wyślij do akceptacji” → zleceniobiorca widzi rachunek w „Do zrobienia” (bez maila w F1, poza opcjonalnym przyciskiem „wyślij przypomnienie” = jeden ręczny mail).
4. Zleceniobiorca: **Akceptuję** albo **Zgłaszam uwagę** (z komentarzem).
5. Firma zatwierdza → generowany PDF z danymi obu stron, okresem, kwotą brutto, datą i informacją o akceptacji elektronicznej (data, hash) → `approved`.
6. Księgowa eksportuje → `exported`.

### 7.5 Akceptacja elektroniczna (umowa / oświadczenie / rachunek)
- Przed akceptacją użytkownik widzi pełny PDF dokumentu.
- Akceptacja = świadome kliknięcie + **ponowne uwierzytelnienie** (hasło lub kod jednorazowy z maila).
- Zapis w `acceptances`: SHA-256 dokumentu, czas, IP, user agent, oraz wpis w audit logu.
- Dokument po akceptacji jest niezmienny. Zmiana tworzy nową wersję wymagającą nowej akceptacji.
- **TODO prawne** (zostaw w README): potwierdzić z prawnikiem, że taka forma jest wystarczająca dla umowy zlecenia, oświadczenia i rachunku (umowa zlecenia nie wymaga formy szczególnej, ale do potwierdzenia). Architektura ma pozwolić podmienić metodę akceptacji na e-podpis zewnętrzny w F2.

### 7.6 Eksport i prawa osób
- Księgowa/admin: CSV (okres, zleceniobiorca, umowa, kwota brutto, status, daty) + ZIP z PDF.
- Zleceniobiorca: „Pobierz moje dane” → ZIP (JSON + pliki), dostęp do kopii danych (art. 15/20 RODO).
- Admin: „Usuń / zanonimizuj osobę” z respektowaniem okresów retencji (dane, które firma musi trzymać z mocy prawa, są blokowane do końca okresu, a reszta usuwana).

## 8. UI — widoki

- **Firma:** Dashboard (kafelki „do zrobienia”), Zleceniobiorcy (lista ze wskaźnikiem kompletności dokumentów), Umowy, Rachunki (widok miesiąca), Dokumenty, Ustawienia (organizacja, użytkownicy, retencja, klauzula RODO, SMTP test), Audit log.
- **Zleceniobiorca (mobile-first):** Do zrobienia, Moje umowy, Moje rachunki, Dokumenty, Profil, Moje dane (eksport). Akceptacja rachunku w ≤ 3 tapnięciach + reauth.
- **Księgowa:** Rachunki zatwierdzone per miesiąc, Eksport.
- Każdy ekran z danymi osobowymi: brak danych w URL (ID jako UUID, bez imion i emaili w ścieżkach i query string).

## 9. Tryb DEMO (`DEMO_MODE=true`)

- Stały baner: „Wersja demonstracyjna — nie wgrywaj prawdziwych dokumentów ani danych osobowych”.
- Seed demo + **reset do seeda codziennie o 03:00** oraz komenda `./scripts/demo-reset.sh`.
- Konta demo z hasłami w README demo: `admin@demo.local`, `ksiegowa@demo.local`, `zleceniobiorca@demo.local`. Dla kont demo 2FA wyłączone.
- Wszystkie maile idą do Mailpit (podgląd pod `/mailpit` za basic auth). Nic nie wychodzi na zewnątrz.
- Upload: max 5 MB, tylko PDF/PNG/JPG; pliki kasowane przy resecie.
- Rate limiting zaostrzony; rejestracja nowych organizacji wyłączona.
- `robots.txt` = disallow, nagłówek `X-Robots-Tag: noindex`.
- Demo stoi na VPS PAH tą samą paczką (`install.sh --demo`).

## 10. Etapy pracy

1. **E1 — Szkielet i infrastruktura:** repo, Docker Compose (app, db, clamav, caddy, mailpit, backup), `.env.example`, walidacja env przez zod, migracje, seed, healthcheck `/api/health`, CI z Trivy. `install.sh`, `update.sh`, `backup.sh`, `restore.sh` w wersji podstawowej.
2. **E2 — Auth i uprawnienia:** logowanie, 2FA, zaproszenia, role, warstwa `authz`, RLS, macierz testów uprawnień, rate limiting, nagłówki bezpieczeństwa, audit log.
3. **E3 — Pliki:** `StorageDriver`, szyfrowanie, skan AV, limity, pobieranie przez aplikację z kontrolą uprawnień.
4. **E4 — Domena:** profile, umowy, oświadczenia + PDF, rachunki + PDF, akceptacje z reauth, dashboard „do zrobienia”.
5. **E5 — Księgowa, eksporty, prawa osób, retencja.**
6. **E6 — Tryb DEMO**, reset, seed demo, dokumentacja demo, wdrożenie na VPS PAH.
7. **E7 — Utwardzenie:** przegląd vs `SECURITY_RODO.md` (checklista), test odtwarzania backupu end-to-end, dokumentacja (`README.md`, `INSTALL.md`, `docs/TOMS.md`), Playwright dla krytycznych flow.

## 11. Kryteria akceptacji F1

- [ ] `./install.sh` na czystym Ubuntu 24.04 LTS stawia działającą aplikację z HTTPS w < 15 min.
- [ ] Admin z 2FA zaprasza 2 zleceniobiorców; obaj kończą onboarding z klauzulą RODO i oświadczeniem.
- [ ] Umowa z plikiem PDF: skan AV ok, plik zaszyfrowany na dysku (weryfikacja testem: surowy plik w wolumenie nie jest czytelnym PDF).
- [ ] Rachunek: utworzenie → akceptacja z telefonu z reauth → zatwierdzenie → PDF z hashem → eksport CSV + ZIP przez księgową.
- [ ] Dashboard pokazuje: umowę wygasającą za 7 dni, studenta kończącego 26 lat, nieaktualne oświadczenie.
- [ ] Testy uprawnień: zleceniobiorca A nie widzi niczego zleceniobiorcy B; księgowa nie edytuje; member nie widzi audit logu; brak dostępu do plików przez zgadnięcie ID.
- [ ] Audit log nie daje się zmodyfikować (test UPDATE/DELETE kończy się błędem).
- [ ] `backup.sh` → `restore.sh` na nowej maszynie odtwarza bazę **i pliki**, a aplikacja działa.
- [ ] `update.sh` z nieudaną migracją wykonuje automatyczny rollback.
- [ ] Trivy: brak podatności CRITICAL w obrazach; `npm audit`: brak high/critical w zależnościach produkcyjnych (lub udokumentowany wyjątek).
- [ ] Demo: baner, reset nocny, maile tylko w Mailpit.

## 12. Otwarte decyzje (nie blokują E1–E3)
- Nazwa produktu i domena demo.
- Domyślne `hours_entered_by`: firma czy zleceniobiorca.
- Ostateczna treść pytań oświadczenia ZUS (konsultacja z księgową).
- Domyślne okresy retencji (konsultacja z księgową/prawnikiem; patrz `SECURITY_RODO.md` §6).
