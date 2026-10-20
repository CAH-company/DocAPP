#!/usr/bin/env bash
# Aktualizacja z backupem i rollbackiem. Użycie: sudo ./scripts/update.sh --image <ref> [--help]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

NEW_IMAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image) NEW_IMAGE="$2"; shift 2 ;;
    -h|--help) sed -n '2,2p' "$0"; exit 0 ;;
    *) die "Nieznana opcja: $1" ;;
  esac
done
[ -n "$NEW_IMAGE" ] || die "Podaj --image (np. ghcr.io/org/obieg-rachunkow:1.2.0)"
need_root

OLD_IMAGE=$(env_get APP_IMAGE)
OLD_VER="${OLD_IMAGE##*:}"; NEW_VER="${NEW_IMAGE##*:}"

# 1. Kontrola zdrowia przed startem
disk_free_pct=$(df --output=pcent / | tail -1 | tr -dc 0-9); disk_free_pct=$((100 - disk_free_pct))
[ "$disk_free_pct" -ge 15 ] || die "Wolne miejsce na dysku < 15% (${disk_free_pct}%)"
compose ps --status running --services | grep -q '^app$' || die "Kontener app nie działa, napraw przed aktualizacją"
last=$(compose exec -T backup cat /cache/last_backup.json 2>/dev/null || true)
[ "$(echo "$last" | jq -r .status 2>/dev/null)" = "OK" ] || die "Ostatni backup nie jest OK; uruchom backup.sh"
age_h=$(( ( $(date +%s) - $(date -d "$(echo "$last" | jq -r .finished_at)" +%s) ) / 3600 ))
[ "$age_h" -le 26 ] || die "Ostatni backup ma ${age_h} h (limit 26 h)"

# 2. Backup przed aktualizacją
log "Backup pre-update-${NEW_VER}"
compose exec -T backup /usr/local/bin/run-backup.sh --tag "pre-update-${NEW_VER}"

rollback() {
  log "ROLLBACK do ${OLD_IMAGE}"
  env_set APP_IMAGE "$OLD_IMAGE"
  compose up -d --force-recreate app || true
  maintenance_log "update ${OLD_VER}->${NEW_VER} ROLLBACK"
  log "Jeśli migracja zmieniła bazę niekompatybilnie: odtwórz snapshot pre-update-${NEW_VER} (restore.sh)."
  exit 1
}

# 3-5. Obraz, migracje, restart, healthcheck
env_set APP_IMAGE "$NEW_IMAGE"
log "Pobieram/buduję ${NEW_IMAGE}"
compose pull app migrate 2>/dev/null || compose build app migrate

log "Migracje"
compose run --rm migrate || rollback

log "Restart aplikacji"
compose up -d --no-deps app || rollback
for _ in $(seq 1 24); do
  if compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    maintenance_log "update ${OLD_VER}->${NEW_VER} OK"
    log "Zaktualizowano do ${NEW_VER}"
    exit 0
  fi
  sleep 5
done
rollback
