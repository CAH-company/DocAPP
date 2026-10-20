# Obieg rachunków

System obiegu umów zlecenia, oświadczeń ZUS i rachunków miesięcznych. Instalowany u klienta (Docker Compose). Specyfikacja: `BRIEF.md`, `SECURITY_RODO.md`, `MAINTENANCE.md`.

## Status

| Etap | Stan |
|---|---|
| E1 Szkielet i infrastruktura | gotowy kod, **infrastruktura niezweryfikowana** (brak Dockera lokalnie, test na VPS) |
| E2 Auth i uprawnienia | gotowy (testy na PGlite: RLS, authz, zaproszenia, blokady); end-to-end w przeglądarce niesprawdzony |
| E3 Pliki | gotowy (szyfrowanie strumieniowe, ClamAV fail-closed, API `/api/v1/files`); ClamAV i S3 niesprawdzone na żywo |
| E4–E7 | do zrobienia |

**Uwaga:** serwer testowy działa bez ClamAV. Lista rzeczy do zamknięcia przed produkcją: `docs/TODO.md`.

## Dev

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
```

Stack dev/prod: `deploy/` (Compose), `scripts/` (install, update, backup, restore), `backup/` (obraz restic + supercronic).

## TODO prawne

Potwierdzić z prawnikiem, że akceptacja elektroniczna (klik + ponowne uwierzytelnienie, hash dokumentu) jest wystarczająca dla umowy zlecenia, oświadczenia i rachunku. Architektura pozwoli podmienić metodę na e-podpis zewnętrzny w F2 (BRIEF §7.5).

## Znane odstępstwa i decyzje

- `audit_log` jest append-only (trigger). Retencja audit logu (5 lat) wymaga kontrolowanego obejścia, do ustalenia w E5.
- Rachunek zawiera kwotę brutto; MVP nie liczy składek ZUS ani zaliczki PIT.
- `hours_entered_by` domyślnie: admin firmy (decyzja właściciela produktu, zmienna w ustawieniach).
