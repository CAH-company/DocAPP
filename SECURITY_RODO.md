# SECURITY_RODO — wymagania bezpieczeństwa i ochrony danych

> Część specyfikacji razem z `BRIEF.md` i `MAINTENANCE.md`. Przy sprzeczności **ten dokument ma pierwszeństwo**.
> Każde wymaganie oznaczone **[MUST]** jest warunkiem ukończenia F1. **[SHOULD]** realizuj, jeśli nie wymaga dużych zmian. Jeśli pomijasz, zapisz to w `docs/SECURITY_EXCEPTIONS.md` z uzasadnieniem.
> Claude Code **nie pisze dokumentów prawnych** (umów, polityk, klauzul) jako finalnych. Tworzy szablony z wyraźnym `TODO: weryfikacja prawnika` w `docs/legal/`.

---

## 1. Ramy odniesienia

- **RODO (UE 2016/679):** art. 5 (zasady), art. 25 (privacy by design & by default), art. 28 (podmiot przetwarzający), art. 30 (rejestry), art. 32 (bezpieczeństwo), art. 33–34 (naruszenia), art. 15–20 (prawa osób).
- **OWASP ASVS 4.x poziom 2:** standard weryfikacji aplikacji. Checklista w `docs/ASVS_CHECKLIST.md` (sekcje V1–V14, status per wymaganie).
- **OWASP Top 10:** minimum, którego nie wolno pominąć.
- **ISO/IEC 27001 Załącznik A:** jako szkielet procedur (bez certyfikacji): kontrola dostępu, kryptografia, kopie zapasowe, logowanie, zarządzanie podatnościami, incydenty.
- **CIS Benchmarks (Docker, Ubuntu)** jako odniesienie przy utwardzaniu serwera i kontenerów.

## 2. Role w RODO (dla kontekstu architektury)

- **Firma-klient = administrator** danych swoich zleceniobiorców i pracowników.
- **PAH** dostarcza oprogramowanie. Przy pakiecie utrzymania z dostępem do serwera PAH jest **podmiotem przetwarzającym** (umowa powierzenia, dziennik prac serwisowych).
- Konsekwencja dla kodu: aplikacja **nie wysyła żadnych danych osobowych poza serwer klienta**. Wyjątki muszą być jawne, konfigurowalne przez klienta i domyślnie wyłączone (SMTP klienta jest konfiguracją klienta, nie naszym transferem).

## 3. Minimalizacja danych [MUST]

| Dana | Decyzja F1 |
|---|---|
| Imię, nazwisko, email | zbieramy (niezbędne) |
| Adres | zbieramy (rachunek) |
| Numer konta | zbieramy, **szyfrowany na poziomie pola**, w UI maskowany (`•••• 1234`) |
| Data urodzenia | zbieramy (alert 26 lat przy statusie studenta); widoczna tylko dla admina/member i samej osoby |
| **PESEL** | **NIE zbieramy w F1.** Pole przygotowane w kodzie jako wyłączone flagą `FEATURE_PESEL=false`. Jeśli włączone: szyfrowane jak nr konta |
| Skan legitymacji | **nie wymagamy.** Zbieramy flagę „student” i datę ważności statusu. Opcjonalny upload tylko, jeśli firma włączy to w ustawieniach |
| Dowód osobisty / skany ID | **nie zbieramy** |
| Telemetria / analityka | **brak** w aplikacji klienta (zero Google Analytics, zero zewnętrznych pikseli) |

Zasada privacy by default: każda nowa opcja zbierania danych jest domyślnie wyłączona.

## 4. Kryptografia [MUST]

### 4.1 W tranzycie
- Tylko HTTPS (Caddy, TLS 1.2+, preferowany 1.3), HSTS (`max-age=31536000; includeSubDomains`).
- Komunikacja między kontenerami w wydzielonej sieci Dockera. Postgres i ClamAV **bez portów wystawionych na hosta**.
- SMTP: wymagane STARTTLS/TLS (konfiguracja odrzuca połączenie bez szyfrowania, chyba że `SMTP_ALLOW_INSECURE=true` w dev).

### 4.2 W spoczynku — pola wrażliwe
- AES-256-GCM (Node `crypto` lub libsodium), **envelope encryption**:
  - `MASTER_KEY` (KEK) z `.env`, generowany przez `install.sh`, 32 bajty, nigdy w bazie ani repo;
  - każda wartość ma zapisany `key_id`, co umożliwia rotację klucza (`scripts/rotate-keys.sh` przeszyfrowuje dane).
- Szyfrowane pola: `bank_account_enc`, `totp_secret_enc`, ewentualnie `pesel_enc`.

### 4.3 W spoczynku — pliki
- Każdy plik szyfrowany przez aplikację **przed zapisem** do `StorageDriver`:
  - losowy klucz pliku (DEK) AES-256-GCM, a DEK zaszyfrowany KEK-iem i zapisany w metadanych (`files.key_id` + nagłówek pliku);
  - strumieniowo (pliki do 20 MB, ale bez ładowania całości do pamięci, jeśli to możliwe).
- `sha256_plain` liczony przed szyfrowaniem (integralność i dowód).
- Na dysku nazwy plików to losowe UUID. Oryginalna nazwa trafia tylko do bazy.

### 4.4 Hasła i tokeny
- Hasła: **Argon2id** (lub domyślny bezpieczny algorytm biblioteki auth, jeśli to Argon2id/scrypt). Minimum 12 znaków, sprawdzanie na liście haseł skompromitowanych lokalnie (bez wysyłki do zewnętrznych API) [SHOULD].
- Tokeny zaproszeń / resetu / magic link: losowe ≥ 256 bitów, w bazie **tylko hash**, jednorazowe, z TTL.
- Sesje: cookie `HttpOnly`, `Secure`, `SameSite=Lax`, rotacja ID po logowaniu, wygaśnięcie po 30 min bezczynności (admin/accountant) i 7 dniach absolutnie.

### 4.5 Kopie zapasowe
- restic (AES-256), klucz repozytorium **inny niż `MASTER_KEY`**. Przechowywany przez klienta (i PAH przy pakiecie utrzymania) poza serwerem. Szczegóły w `MAINTENANCE.md`.

## 5. Kontrola dostępu [MUST]

- RBAC wg `BRIEF.md` §5. Kontrola po stronie serwera w jednej warstwie `authz`.
- Izolacja danych: warstwa repozytoriów wymusza `org_id`/`contractor_id`, plus **Postgres RLS** z ustawianym per-request kontekstem.
- Brak IDOR: ID jako UUID v4/v7, ale **bezpieczeństwo nie opiera się na nieprzewidywalności**. Każdy odczyt sprawdza uprawnienia.
- **2FA (TOTP) obowiązkowe** dla `admin` i `accountant`, opcjonalne dla `member` i `contractor` (admin może wymusić).
- Ponowne uwierzytelnienie przed: akceptacją dokumentu, eksportem danych, zmianą nr konta, zmianą ról, usuwaniem danych.
- Rate limiting: logowanie (np. 5 prób / 15 min / konto + per IP), reset hasła, zaproszenia, API. Blokada konta z odblokowaniem przez admina albo po czasie.
- Konto techniczne bazy dla aplikacji **bez uprawnień superusera**. Osobne konto do migracji.

## 6. Retencja i usuwanie [MUST]

- Okresy retencji **konfigurowalne przez admina** per typ danych (umowy, rachunki, oświadczenia, pliki pozostałe, konta nieaktywne, audit log).
- Domyślne wartości w configu oznaczone `TODO: potwierdzić z księgową/prawnikiem`. Punkt wyjścia do dyskusji: dokumenty rozliczeniowe 5 lat od końca roku, w którym upłynął termin płatności podatku; audit log 5 lat; zaproszenia niewykorzystane 30 dni.
- Job retencji (dzienny): usuwa lub anonimizuje rekordy **i pliki**, zapisuje wynik w `retention_jobs` i audit logu (bez danych osobowych).
- Usunięcie pliku = usunięcie z magazynu (nie tylko flaga). Backupy wygasają zgodnie z polityką rotacji restic (`MAINTENANCE.md`). Udokumentuj, że dane znikają z backupów najpóźniej po okresie rotacji.
- Eksport danych osoby (art. 15/20): ZIP z JSON + pliki.

## 7. Bezpieczeństwo aplikacji [MUST]

- **Walidacja wejścia:** zod na każdym endpoint/action, typy i długości, odrzucanie nieznanych pól.
- **Wstrzyknięcia:** wyłącznie zapytania parametryzowane (Drizzle). Zakaz sklejania SQL.
- **XSS:** brak `dangerouslySetInnerHTML` dla danych użytkownika. **CSP** restrykcyjne (`default-src 'self'`, nonce dla skryptów, `frame-ancestors 'none'`).
- **CSRF:** mechanizm biblioteki auth / Server Actions + SameSite. Mutacje tylko POST/PUT/DELETE.
- **Nagłówki:** HSTS, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimalne, `X-Frame-Options: DENY`.
- **Upload:**
  - whitelista MIME **i** weryfikacja magic bytes (PDF, DOCX, JPG, PNG);
  - limit rozmiaru (20 MB prod, 5 MB demo);
  - **skan ClamAV przed zapisem**: zainfekowany plik jest odrzucany i trafia do audit logu, a ClamAV niedostępny blokuje upload (fail closed);
  - pliki nigdy nie są serwowane z tej samej ścieżki co aplikacja bez kontroli. Pobranie przez endpoint z autoryzacją, `Content-Disposition: attachment` (lub `inline` tylko dla PDF w podglądzie), poprawny `Content-Type`;
  - DOCX nie jest renderowany w przeglądarce w F1, tylko pobierany.
- **Dane w URL:** zakaz danych osobowych w ścieżkach i query string.
- **Błędy:** użytkownik widzi ogólny komunikat i ID błędu. Szczegóły tylko w logach serwera.
- **Zależności:** lockfile w repo, `npm audit` + Trivy w CI, Dependabot/Renovate [SHOULD].
- **Sekrety:** tylko w `.env` (uprawnienia 600, właściciel root), `.env.example` bez wartości, skan sekretów w CI (gitleaks) [SHOULD].

## 8. Logowanie i audyt [MUST]

- **Audit log biznesowy** (tabela `audit_log`, append-only, trigger blokujący UPDATE/DELETE):
  - logowanie, logowanie nieudane, zmiana hasła, włączenie/wyłączenie 2FA;
  - zaproszenie, zmiana roli, dezaktywacja;
  - utworzenie, zmiana, akceptacja i zatwierdzenie umowy, oświadczenia i rachunku;
  - upload, pobranie i usunięcie pliku;
  - eksport, eksport danych osoby, usunięcie/anonimizacja, uruchomienie retencji;
  - zmiana ustawień.
- Wpisy audit logu zawierają ID encji, **nie treść danych osobowych** (np. `contractor_id`, a nie imię i nazwisko).
- **Logi techniczne** (stdout kontenerów): JSON, bez danych osobowych, bez tokenów i haseł (redakcja pól `password`, `token`, `authorization`, `cookie`, `email` → hash). Rotacja w Dockerze (`max-size`, `max-file`).
- Admin ma podgląd audit logu w UI z filtrowaniem i eksportem CSV.

## 9. Kontenery i serwer [MUST]

- Obrazy bazowe oficjalne, przypięte do wersji (bez `latest`). Aplikacja na `node:XX-alpine` lub distroless, **użytkownik nie-root**.
- `read_only: true` dla kontenera aplikacji (z wyjątkiem jawnych wolumenów tmp), `no-new-privileges`, `cap_drop: ALL`.
- Limity zasobów w Compose (pamięć/CPU).
- Healthchecki dla każdego serwisu.
- Wolumeny: `db_data`, `files_data`, `caddy_data`, `clamav_db`, `backup_cache`.
- Zalecenia dla hosta (wykonywane przez `install.sh` lub opisane w `INSTALL.md`):
  - Ubuntu LTS z `unattended-upgrades`;
  - UFW: 22 (tylko klucze), 80, 443;
  - fail2ban dla SSH;
  - wyłączone logowanie roota i hasłem;
  - **szyfrowanie dysku** jako zalecenie [SHOULD], bo zależy od dostawcy VPS;
  - serwer w regionie UE (wymaganie w `INSTALL.md`).

## 10. Naruszenia ochrony danych [MUST — dokumentacja]

- `docs/INCIDENT_RESPONSE.md`: wykrycie → zabezpieczenie (izolacja, rotacja kluczy) → ocena (jakie dane, ile osób) → **powiadomienie administratora (klienta) bez zbędnej zwłoki**, cel: ≤ 24 h, bo klient ma 72 h na zgłoszenie do UODO → raport po zdarzeniu.
- Szablon zgłoszenia incydentu do klienta.
- Skrypt `scripts/incident-snapshot.sh`: zrzut logów i stanu kontenerów do zaszyfrowanego archiwum (bez kopiowania danych osobowych z bazy).

## 11. Dokumentacja do wygenerowania w repo

| Plik | Zawartość | Kto finalizuje |
|---|---|---|
| `docs/TOMS.md` | **Opis środków technicznych i organizacyjnych** (art. 32): wszystko z tego dokumentu opisane językiem dla klienta | PAH (gotowe do wysłania klientowi) |
| `docs/ASVS_CHECKLIST.md` | status każdego wymagania ASVS L2 | PAH |
| `docs/INCIDENT_RESPONSE.md` | procedura naruszeń | PAH |
| `docs/DATA_MAP.md` | jakie dane, gdzie, po co, jak długo, kto ma dostęp (wsparcie dla rejestru czynności klienta) | PAH |
| `docs/legal/umowa-powierzenia.TEMPLATE.md` | szablon z `TODO: weryfikacja prawnika` | prawnik |
| `docs/legal/klauzula-informacyjna.TEMPLATE.md` | domyślna klauzula do edycji przez klienta | prawnik / klient |
| `docs/legal/regulamin-licencji.TEMPLATE.md` | warunki licencji i utrzymania | prawnik |
| `docs/SECURITY_EXCEPTIONS.md` | odstępstwa od [SHOULD] z uzasadnieniem | PAH |
| `SECURITY.md` | jak zgłaszać podatności | PAH |

## 12. Checklista przed oddaniem F1

- [ ] Wszystkie [MUST] spełnione albo z udokumentowaną decyzją właściciela produktu.
- [ ] Test: surowy plik z wolumenu i surowa wartość `bank_account_enc` z bazy są nieczytelne bez `MASTER_KEY`.
- [ ] Test: backup restic nie da się otworzyć bez klucza repozytorium.
- [ ] Test RLS: zapytanie z kontekstem org A nie zwraca wierszy org B (także przy błędzie w warstwie repozytoriów, czyli test bezpośrednio na bazie).
- [ ] Skan ZAP (baseline) na instancji demo bez alertów High [SHOULD].
- [ ] Grep logów po teście E2E: brak emaili, nazwisk, numerów kont, tokenów.
- [ ] `docs/TOMS.md` i `docs/DATA_MAP.md` aktualne.
