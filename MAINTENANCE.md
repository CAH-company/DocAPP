# MAINTENANCE — instalacja, backupy, aktualizacje, utrzymanie

> Część specyfikacji razem z `BRIEF.md` i `SECURITY_RODO.md`.
> Ten dokument opisuje (1) skrypty i kontenery, które Claude Code ma zbudować, oraz (2) procedury utrzymania, które PAH wykonuje u klientów w pakiecie utrzymania. Część (2) trafia do repo jako `docs/OPERATIONS.md`.

---

## 1. Założenia

- Ten sam proces instalacji i aktualizacji u każdego klienta i na demo. **Zero ręcznych zmian na serwerach.** Wszystko przez skrypty z repo.
- PAH przy utrzymaniu **nie zagląda w dane**. Diagnostyka odbywa się przez skrypty, które zwracają wyłącznie informacje techniczne. Dostęp do danych tylko na zgłoszenie klienta, odnotowany w dzienniku prac serwisowych.
- Serwer jest na koncie klienta, w regionie UE. Koszt serwera ponosi klient.

## 2. Struktura repo (część operacyjna)

```
/deploy
  docker-compose.yml
  docker-compose.demo.yml        # nadpisania dla DEMO (mailpit, limity, reset)
  Caddyfile
  .env.example
/scripts
  install.sh        # pierwsza instalacja
  update.sh         # aktualizacja z backupem i rollbackiem
  rollback.sh       # powrót do poprzedniej wersji
  backup.sh         # backup ręczny (ten sam co automatyczny)
  restore.sh        # odtworzenie z wybranego snapshotu
  restore-test.sh   # test odtworzenia na tymczasowych kontenerach
  diagnose.sh       # raport techniczny BEZ danych osobowych
  rotate-keys.sh    # rotacja MASTER_KEY (przeszyfrowanie pól i plików)
  demo-reset.sh     # tylko DEMO
  incident-snapshot.sh
/docs
  INSTALL.md  OPERATIONS.md  BACKUP.md  ...
```

Każdy skrypt:
- `set -euo pipefail`;
- czytelny output;
- kod wyjścia ≠ 0 przy błędzie;
- log do `/var/log/<app>/ops.log` (bez danych osobowych);
- `--help`;
- idempotentny tam, gdzie to możliwe.

## 3. install.sh

1. Sprawdza: OS (Ubuntu 22.04/24.04 LTS), uprawnienia root, Docker + Compose plugin (instaluje, jeśli brak), wolne miejsce (min. 20 GB), RAM (min. 2 GB; 4 GB zalecane z ClamAV), czy domena wskazuje na IP serwera.
2. Pyta o: domenę, email admina, SMTP (host/port/user/hasło/nadawca), cel backupu (ścieżka dysku zewnętrznego i/lub S3: endpoint, bucket, klucze), opcjonalnie włączenie agenta zdrowia PAH.
3. Generuje: `MASTER_KEY`, `AUTH_SECRET`, hasła do bazy (aplikacyjne i migracyjne), `RESTIC_PASSWORD`. Zapisuje do `/opt/<app>/.env` (chmod 600).
4. **Wyświetla jednorazowo `RESTIC_PASSWORD` i `MASTER_KEY`** z instrukcją: zapisz w menedżerze haseł i w drugim bezpiecznym miejscu poza serwerem. Bez nich nie odtworzysz danych. Wymaga potwierdzenia „zapisałem”.
5. Utwardzenie hosta (z flagą `--skip-hardening` dla serwerów klienta zarządzanych przez jego IT): UFW (22/80/443), fail2ban, unattended-upgrades, wyłączenie logowania hasłem SSH (tylko jeśli jest już skonfigurowany klucz, inaczej ostrzeżenie).
6. `docker compose pull && up -d`, migracje, utworzenie admina (link aktywacyjny mailem lub wypisany w konsoli), test SMTP, pierwszy backup, `restore-test.sh`.
7. Podsumowanie: URL, wersja, status backupu, lista następnych kroków.

Flaga `--demo`: używa `docker-compose.demo.yml`, ustawia `DEMO_MODE=true`, ładuje seed demo, pomija pytania o SMTP (Mailpit).

## 4. Backupy

### 4.1 Co i jak
- **Kontener `backup`** (restic + klient Postgres + supercronic).
- **Codziennie (domyślnie 02:00 Europe/Warsaw):**
  1. `pg_dump --format=custom` do katalogu tymczasowego (z konta tylko do odczytu, jeśli możliwe);
  2. `restic backup` zrzutu bazy **i** wolumenu `files_data` w **jednym snapshocie**, żeby baza i pliki były spójne w czasie. Pliki są już zaszyfrowane przez aplikację, a restic szyfruje je drugi raz;
  3. wysyłka do **wszystkich skonfigurowanych celów:**
     - **dysk zewnętrzny** (montowany wolumen, np. `/mnt/backup`);
     - **S3-compatible poza serwerem** w UE (zalecany jako kopia off-site).
     
     Zasada 3-2-1: produkcja + dysk zewnętrzny + off-site;
  4. weryfikacja: `restic check --read-data-subset=5%`;
  5. wynik (OK/FAIL, rozmiar, czas, ID snapshotu) do logu i do agenta zdrowia.
- **Rotacja (`restic forget --prune`):** 7 dziennych, 4 tygodniowe, 6 miesięcznych (konfigurowalne). **Udokumentuj:** usunięte dane znikają z backupów najpóźniej po 6 miesiącach (ważne dla prawa do usunięcia).
- Backup nieudany → alert (agent zdrowia i/lub mail do admina klienta).
- **[SHOULD] F2:** ciągła archiwizacja WAL (pgBackRest lub WAL-G) dla odtwarzania do punktu w czasie. W F1 wystarczy dzienny dump + dodatkowy dump przed każdą aktualizacją.

### 4.2 Klucze
- `RESTIC_PASSWORD` ≠ `MASTER_KEY`.
- Oba przechowywane **poza serwerem**: u klienta, a przy pakiecie utrzymania także w sejfie PAH (menedżer haseł z 2FA, dostęp max 2 osoby).
- Utrata obu kluczy = trwała utrata danych. Napisz to wprost w `docs/BACKUP.md`.

### 4.3 restore.sh
- Lista snapshotów → wybór → odtworzenie bazy i plików do **nowych** wolumenów → przełączenie → healthcheck.
- Tryb `--target-dir` do odtworzenia na innym serwerze (migracja / disaster recovery).
- Wymaga `MASTER_KEY` (bez niego pliki i pola zaszyfrowane są nieczytelne nawet po odtworzeniu).

### 4.4 restore-test.sh (raz w miesiącu automatycznie + przed każdym major upgrade)
1. Odtwarza najnowszy snapshot do **tymczasowych** kontenerów w osobnej sieci.
2. Sprawdza: migracje zgodne, liczba rekordów w kluczowych tabelach zgadza się z produkcją (porównanie liczb, nie treści), losowe 3 pliki da się odszyfrować i sha256 się zgadza.
3. Usuwa tymczasowe kontenery i wolumeny.
4. Raportuje OK/FAIL (bez danych osobowych).

## 5. Aktualizacje aplikacji

### 5.1 Wersjonowanie
- Semver. Obrazy w GHCR podpisane (cosign) [SHOULD].
- `CHANGELOG.md` z sekcją „Wymaga uwagi” (migracje, zmiany konfiguracji).
- Migracje **tylko w przód i kompatybilne wstecz o jedną wersję**: najpierw dodaj kolumnę, w następnej wersji usuń starą. Pozwala to na rollback obrazu bez cofania bazy.

### 5.2 update.sh
1. `diagnose.sh`: przerwij, jeśli system niezdrowy (dysk < 15% wolnego, backup starszy niż 26 h, kontener nie działa).
2. **Backup przed aktualizacją** (osobny tag snapshotu `pre-update-vX`).
3. Pull nowego obrazu (konkretna wersja lub `--channel stable`).
4. Uruchom migracje w osobnym kontenerze `migrate`.
5. Restart aplikacji, healthcheck `/api/health` (timeout 120 s).
6. Niepowodzenie w krokach 4–5 → **automatyczny rollback:** poprzedni obraz, a jeśli migracja zmieniła bazę niekompatybilnie, odtworzenie snapshotu `pre-update`.
7. Wpis do dziennika prac serwisowych (`/var/log/<app>/maintenance.log`): kto, kiedy, z jakiej na jaką wersję, wynik.

### 5.3 Pierścienie wydań (procedura PAH)
1. Serwer testowy PAH + demo → 3 dni obserwacji.
2. 1–2 klientów „pilotażowych” → 3 dni.
3. Pozostali klienci w oknie serwisowym.

Wyjątek: poprawki bezpieczeństwa krytyczne idą szybciej, z informacją do klientów.

## 6. Aktualizacje Postgresa i systemu

- **Minor Postgres** (np. 17.x → 17.y): zmiana tagu obrazu w `update.sh`, w ramach comiesięcznej aktualizacji.
- **Major Postgres** (np. 17 → 18): osobny skrypt `scripts/pg-major-upgrade.sh`:
  1. `restore-test.sh`;
  2. dump;
  3. nowy kontener z nową wersją;
  4. restore;
  5. weryfikacja liczb rekordów;
  6. przełączenie;
  7. stary wolumen zachowany przez 14 dni.
  
  Tylko w zaplanowanym oknie, z informacją do klienta.
- **System hosta:** unattended-upgrades (security) codziennie. Restart przy aktualizacji kernela w oknie serwisowym. Upgrade wersji Ubuntu LTS raz na ~2 lata, jako osobna usługa płatna.
- **ClamAV:** bazy sygnatur aktualizowane automatycznie (freshclam w kontenerze). Alert, jeśli starsze niż 48 h.
- **Certyfikat TLS:** Caddy odnawia automatycznie. Alert, jeśli ważny krócej niż 14 dni.

## 7. Agent zdrowia (opcjonalny, domyślnie WYŁĄCZONY)

- Kontener `health-agent`, włączany flagą `HEALTH_AGENT_ENABLED=true` za zgodą klienta (zapisaną w umowie utrzymania).
- Co 5 min wysyła do panelu PAH (HTTPS, token per instancja) **wyłącznie:**
  - ID instancji, wersję aplikacji, wersję Postgresa, uptime;
  - status kontenerów (up/down), czas odpowiedzi `/api/health`;
  - wolne miejsce na dysku (%), RAM (%), rozmiar bazy i plików (MB);
  - status ostatniego backupu (OK/FAIL, wiek w godzinach), status ostatniego `restore-test`;
  - datę ważności certyfikatu TLS i wiek sygnatur ClamAV;
  - liczbę błędów 5xx w ostatniej godzinie (liczba, nie treść).
- **Nigdy:** danych osobowych, nazw plików, treści logów, emaili, liczby użytkowników z nazwami.
- Format payloadu udokumentowany w `docs/HEALTH_AGENT.md`, żeby klient mógł zweryfikować, co wychodzi. Opcja `--dry-run` wypisuje payload lokalnie.
- Panel floty po stronie PAH (osobny projekt, poza tym repo): Uptime Kuma lub Grafana + alerty na telefon.

## 8. diagnose.sh

Raport tekstowy do wklejenia w zgłoszenie, bez danych osobowych:
- wersje, status kontenerów, healthchecki;
- dysk, RAM, CPU load, rozmiar bazy, liczba połączeń, najdłużej trwające zapytania (**tylko czas i fingerprint zapytania z `pg_stat_statements`, bez parametrów**);
- status autovacuum (tabele z największym `n_dead_tup` jako nazwa tabeli + liczba);
- ostatni backup i restore-test, wiek sygnatur ClamAV, ważność TLS;
- ostatnie 50 linii logów aplikacji **po redakcji** (te same reguły co w `SECURITY_RODO.md` §8).

## 9. Harmonogram utrzymania (procedura PAH, do `docs/OPERATIONS.md`)

| Częstotliwość | Czynność | Tryb |
|---|---|---|
| Ciągle | healthcheck, alerty: aplikacja nie odpowiada, dysk < 15%, backup nieudany/starszy niż 26 h, TLS < 14 dni, ClamAV > 48 h | automat (agent) |
| Codziennie | backup bazy + plików na dysk zewnętrzny i off-site, `restic check` (subset), security updates systemu, job retencji | automat |
| Co tydzień | przegląd alertów i błędów 5xx całej floty | ręcznie, ~5 min / klient |
| Co miesiąc | `restore-test.sh`, aktualizacja aplikacji (pierścienie), minor Postgres, raport miesięczny dla klienta (wersja, uptime, backupy, wykonane prace) | automat + akceptacja |
| Co kwartał | przegląd kont adminów u klienta (raport, decyzja klienta), przegląd dostępów PAH do serwerów, skan Trivy działających obrazów, przegląd wzrostu bazy i dysku, `restic check --read-data` (pełny) | ręcznie |
| Co rok | major Postgres (jeśli dostępny i stabilny ≥ 3 mies.), rotacja `AUTH_SECRET` i haseł bazy, ewentualnie rotacja `MASTER_KEY`, przegląd `docs/TOMS.md` i umowy powierzenia, ćwiczenie disaster recovery (pełne odtworzenie na nowym serwerze) | zaplanowane okno |

**Okno serwisowe:** stałe, np. wtorek 20:00–22:00, zapisane w umowie. Klient informowany 48 h wcześniej o pracach wymagających przestoju.

**Dziennik prac serwisowych:** każdy dostęp PAH do serwera klienta (kto, kiedy, cel, czy był dostęp do danych osobowych: tak/nie, numer zgłoszenia). Wymagany przy umowie powierzenia.

## 10. Disaster recovery

- **Cele (do potwierdzenia w umowie):** RPO ≤ 24 h (F1, dzienny backup; po wdrożeniu WAL ≤ 15 min), RTO ≤ 8 h w dni robocze.
- Procedura w `docs/DISASTER_RECOVERY.md`:
  1. nowy VPS;
  2. `install.sh --restore`;
  3. podanie `MASTER_KEY` i `RESTIC_PASSWORD`;
  4. wybór snapshotu;
  5. przepięcie DNS;
  6. weryfikacja.
- Ćwiczone raz w roku na każdej instancji objętej utrzymaniem (na serwerze tymczasowym, potem usuwanym).

## 11. Co jest w abonamencie utrzymania, a co płatne osobno (do umowy)

- **W abonamencie:** monitoring, backupy z testem odtwarzania, security updates, aktualizacje aplikacji i minor Postgres, raport miesięczny, reakcja na incydenty w ustalonym SLA, przegląd kwartalny.
- **Płatne osobno:** major Postgres, upgrade Ubuntu LTS, odtwarzanie danych po błędzie użytkownika klienta, migracja serwera, zmiany na życzenie, szkolenia.

## 12. Kryteria akceptacji (część operacyjna F1)

- [ ] `install.sh` i `install.sh --demo` działają na czystym Ubuntu 24.04 LTS.
- [ ] Backup trafia jednocześnie na „dysk zewnętrzny” (testowo: zamontowany katalog) i S3 (testowo: MinIO/Garage w CI lub lokalnie).
- [ ] `restore-test.sh` przechodzi; `restore.sh --target-dir` odtwarza instancję na drugiej maszynie.
- [ ] `update.sh` z celowo zepsutą migracją wraca do poprzedniej wersji bez utraty danych.
- [ ] `diagnose.sh` i payload agenta (`--dry-run`): automatyczny test, że nie zawierają emaili, nazwisk ani numerów kont z seeda.
- [ ] `docs/INSTALL.md`, `docs/BACKUP.md`, `docs/OPERATIONS.md`, `docs/DISASTER_RECOVERY.md`, `docs/HEALTH_AGENT.md` istnieją i są zgodne z działaniem skryptów.
