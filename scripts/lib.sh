#!/usr/bin/env bash
# Wspólne funkcje skryptów serwisowych. Logi bez danych osobowych.
set -euo pipefail

APP_NAME="obieg-rachunkow"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
DEPLOY_DIR="${APP_DIR}/deploy"
LOG_DIR="/var/log/${APP_NAME}"
OPS_LOG="${LOG_DIR}/ops.log"

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_DIR="${APP_DIR}/logs"; OPS_LOG="${LOG_DIR}/ops.log"; mkdir -p "$LOG_DIR"
fi

log()  { local m="[$(date -u +%FT%TZ)] $*"; echo "$m"; echo "$m" >> "$OPS_LOG" 2>/dev/null || true; }
die()  { log "BŁĄD: $*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || die "Uruchom jako root (sudo)."; }

compose() {
  local files=(-f "${DEPLOY_DIR}/docker-compose.yml")
  if grep -q '^DEMO_MODE=true' "${DEPLOY_DIR}/.env" 2>/dev/null; then
    files+=(-f "${DEPLOY_DIR}/docker-compose.demo.yml")
  fi
  if grep -q '^PROXY=nginx' "${DEPLOY_DIR}/.env" 2>/dev/null; then
    files+=(-f "${DEPLOY_DIR}/docker-compose.nginx.yml")
  fi
  docker compose --project-directory "$DEPLOY_DIR" --env-file "${DEPLOY_DIR}/.env" "${files[@]}" "$@"
}

env_get() { grep -E "^$1=" "${DEPLOY_DIR}/.env" | head -1 | cut -d= -f2-; }

env_set() {
  local key="$1" val="$2" f="${DEPLOY_DIR}/.env"
  if grep -qE "^${key}=" "$f"; then
    sed -i "s|^${key}=.*|${key}=${val//|/\\|}|" "$f"
  else
    echo "${key}=${val}" >> "$f"
  fi
}

gen_hex()  { openssl rand -hex "$1"; }
gen_pass() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }

maintenance_log() {
  # kto, kiedy, co, wynik (MAINTENANCE.md §5.2 pkt 7)
  echo "$(date -u +%FT%TZ) user=${SUDO_USER:-$USER} $*" >> "${LOG_DIR}/maintenance.log" 2>/dev/null || true
}
