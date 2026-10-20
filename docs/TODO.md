# TODO przed produkcją

Rzeczy świadomie odłożone w wersji testowej. Każda musi być zamknięta przed wdrożeniem u klienta.

## [BLOKUJE PRODUKCJĘ] Antywirus ClamAV jest wyłączony na serwerze testowym

- **Stan:** serwer testowy działa z `CLAMAV_ENABLED=false` i bez kontenera `clamav` (za mało wolnego RAM-u, ClamAV potrzebuje ok. 2 GB).
- **Skutek:** uploady nie są skanowane. Pliki dostają `scan_status = 'skipped'` (nie `clean`), a w audit logu jest `scan: "skipped"`.
- **Jak włączyć:**
  1. W `deploy/.env`: `CLAMAV_ENABLED=true` i `COMPOSE_PROFILES=av`.
  2. `docker compose up -d` (pierwszy start pobiera sygnatury, kilka minut).
  3. Test: wgraj plik EICAR, ma być odrzucony; `docker compose stop clamav` ma blokować uploady (503).
  4. Przeskanuj istniejące pliki ze statusem `skipped` (skrypt do napisania w E5/E7) lub usuń dane testowe.
- **Minimum zasobów z ClamAV:** 4 GB RAM na serwerze (2 GB dla samego ClamAV).
