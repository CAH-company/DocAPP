#!/usr/bin/env bash
# Ręczny backup (ten sam mechanizm co automatyczny). Użycie: sudo ./scripts/backup.sh [--tag NAZWA] [--help]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

case "${1:-}" in -h|--help) sed -n '2,2p' "$0"; exit 0 ;; esac
need_root
log "Backup ręczny"
compose exec -T backup /usr/local/bin/run-backup.sh "$@"
maintenance_log "backup $*"
