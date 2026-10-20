#!/bin/bash
# Backup bazy i plików w JEDNYM snapshocie restic, do wszystkich skonfigurowanych celów.
# Tagi: daily (domyślnie) lub pre-update-<ver> (--tag).
set -euo pipefail

TAG="daily"
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --check-full-subset) shift ;;
    -h|--help) echo "Użycie: run-backup.sh [--tag NAZWA]"; exit 0 ;;
    *) echo "Nieznana opcja: $1" >&2; exit 2 ;;
  esac
done

STATUS=/cache/last_backup.json
DUMP_DIR=/cache/dump
START=$(date +%s)
: "${RESTIC_PASSWORD:?Brak RESTIC_PASSWORD}"
export RESTIC_PASSWORD

repos=()
[ -d /backup-disk ] && repos+=("/backup-disk/restic")
if [ -n "${BACKUP_S3_ENDPOINT:-}" ] && [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  repos+=("s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}")
fi
if [ ${#repos[@]} -eq 0 ]; then
  echo "Brak skonfigurowanego celu backupu" >&2
  exit 1
fi

fail() {
  jq -n --arg t "$(date -u +%FT%TZ)" '{status:"FAIL", finished_at:$t}' > "$STATUS"
  echo "BACKUP FAIL: $1" >&2
  exit 1
}
trap 'fail "linia $LINENO"' ERR

rm -f "$DUMP_DIR"/*.dump
pg_dump --format=custom --file "$DUMP_DIR/db.dump"

for repo in "${repos[@]}"; do
  export RESTIC_REPOSITORY="$repo"
  restic cat config >/dev/null 2>&1 || restic init
  restic backup "$DUMP_DIR/db.dump" /data/files --tag "$TAG" --host obieg-rachunkow --quiet
  restic forget --prune --tag daily --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --quiet
  restic check --read-data-subset=5%
done

rm -f "$DUMP_DIR"/*.dump
jq -n --arg t "$(date -u +%FT%TZ)" --argjson s "$(( $(date +%s) - START ))" --arg tag "$TAG" \
  '{status:"OK", finished_at:$t, duration_s:$s, tag:$tag}' > "$STATUS"
echo "BACKUP OK (${TAG}, $(( $(date +%s) - START ))s)"
