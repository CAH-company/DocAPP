#!/usr/bin/env bash
# Odtworzenie bazy i plików z snapshotu restic. Użycie:
#   sudo ./scripts/restore.sh --list
#   sudo ./scripts/restore.sh --snapshot <id|latest> [--repo <repo>] [--yes]
# Wymaga zapisanych w .env: RESTIC_PASSWORD i MASTER_KEY (bez MASTER_KEY pliki i pola są nieczytelne).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

SNAP=""; LIST=false; YES=false; REPO="/backup-disk/restic"
while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=true; shift ;;
    --snapshot) SNAP="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --yes) YES=true; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "Nieznana opcja: $1" ;;
  esac
done
need_root

rx() { compose exec -T -e RESTIC_REPOSITORY="$REPO" backup restic "$@"; }

if $LIST; then rx snapshots; exit 0; fi
[ -n "$SNAP" ] || die "Podaj --snapshot albo --list"

if ! $YES; then
  read -r -p "Nadpiszę bazę i pliki danymi ze snapshotu ${SNAP}. Wpisz 'tak': " a
  [ "$a" = "tak" ] || die "Przerwano"
fi

log "Zatrzymuję app"
compose stop app

log "Odtwarzam snapshot ${SNAP}"
compose exec -T -e RESTIC_REPOSITORY="$REPO" backup sh -c "rm -rf /cache/restore && restic restore ${SNAP} --target /cache/restore"

log "Odtwarzam bazę"
# TODO(E7): odtwarzanie do NOWYCH wolumenów i przełączenie; tu: pg_restore --clean do istniejącej bazy.
compose exec -T backup sh -c "pg_restore --clean --if-exists --no-owner --dbname app /cache/restore/cache/dump/db.dump"

log "Odtwarzam pliki"
# files_data jest w backupie zamontowany read-only, więc kopiujemy przez kontener app (po starcie bez ruchu)
compose run --rm --no-deps --entrypoint sh -v "${APP_NAME}_backup_cache:/cache:ro" app \
  -c "cp -a /cache/restore/data/files/. /data/files/" || die "Kopiowanie plików nieudane"

log "Start app"
compose up -d app
maintenance_log "restore snapshot=${SNAP}"
log "Odtworzono. Sprawdź /api/health i zaloguj się."
