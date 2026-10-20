#!/usr/bin/env bash
# Pierwsza instalacja. Użycie: ./scripts/install.sh [--demo] [--skip-hardening] [--no-antivirus] [--proxy nginx|caddy] [--app-port N] [--test-mail] [--non-interactive] [--help]
#   --proxy nginx   TLS kończy nginx hosta; aplikacja słucha na 127.0.0.1:APP_PORT (bez Caddy)
#   --test-mail     Mailpit zamiast SMTP (maile tylko do podglądu przez tunel SSH, nic nie wychodzi)
#   Bez roota: wymagane --skip-hardening, zainstalowany Docker i członkostwo w grupie docker.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

DEMO=false; SKIP_HARDENING=false; NONINTERACTIVE=false; NO_AV=false; TEST_MAIL=false; PROXY=caddy; APP_PORT=3110
usage() { sed -n '2,2p' "$0"; exit 0; }
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=true ;;
    --skip-hardening) SKIP_HARDENING=true ;;
    --non-interactive) NONINTERACTIVE=true ;;
    --no-antivirus) NO_AV=true ;;
    --test-mail) TEST_MAIL=true ;;
    --proxy) PROXY="${2:-}"; shift ;;
    --app-port) APP_PORT="${2:-}"; shift ;;
    -h|--help) usage ;;
    *) die "Nieznana opcja: $1" ;;
  esac
  shift
done
case "$PROXY" in nginx|caddy) ;; *) die "--proxy: nginx albo caddy" ;; esac
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "--app-port: liczba"

IS_ROOT=false; [ "$(id -u)" -eq 0 ] && IS_ROOT=true
if ! $IS_ROOT; then
  $SKIP_HARDENING || die "Bez roota użyj --skip-hardening (utwardzenie hosta wymaga sudo)."
  docker info >/dev/null 2>&1 || die "Brak dostępu do Dockera (grupa docker?)."
fi

# 1. Wymagania ---------------------------------------------------------------
. /etc/os-release
case "${ID}-${VERSION_ID}" in
  ubuntu-22.04|ubuntu-24.04|debian-12|debian-13) ;;
  *) die "Obsługiwane: Ubuntu 22.04/24.04 LTS, Debian 12/13 (wykryto ${PRETTY_NAME})" ;;
esac
free_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge 20 ] || die "Wymagane min. 20 GB wolnego miejsca (jest ${free_gb} GB)"
ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$ram_mb" -ge 1900 ] || die "Wymagane min. 2 GB RAM (jest ${ram_mb} MB)"
if $NO_AV; then
  log "UWAGA: instalacja BEZ antywirusa (--no-antivirus). Tylko środowisko testowe, patrz docs/TODO.md."
else
  [ "$ram_mb" -ge 3800 ] || log "UWAGA: zalecane 4 GB RAM (ClamAV). Jest ${ram_mb} MB. Rozważ --no-antivirus (tylko test)."
fi

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  $IS_ROOT || die "Brak Dockera/Compose; zainstaluj jako root."
  log "Instaluję Docker + Compose plugin"
  curl -fsSL https://get.docker.com | sh
fi
if ! command -v openssl >/dev/null; then
  $IS_ROOT || die "Brak openssl; zainstaluj jako root."
  apt-get install -y openssl
fi

# 2. Pytania -----------------------------------------------------------------
ask() { # ask VAR "pytanie" [domyślna] [secret]
  local var="$1" q="$2" def="${3-__required__}" secret="${4:-}" val
  if [ -n "${!var:-}" ]; then return; fi
  if $NONINTERACTIVE; then
    [ "$def" != "__required__" ] || die "Brak zmiennej ${var} (tryb --non-interactive)"
    printf -v "$var" '%s' "$def"; return
  fi
  [ "$def" = "__required__" ] && def=""
  if [ -n "$secret" ]; then read -r -s -p "$q: " val; echo; else read -r -p "$q${def:+ [$def]}: " val; fi
  printf -v "$var" '%s' "${val:-$def}"
}

ask DOMAIN "Domena aplikacji (DNS musi wskazywać na ten serwer)"
ask ADMIN_EMAIL "E-mail pierwszego administratora"
ask ORG_NAME "Nazwa firmy" "Moja firma"
if $DEMO || $TEST_MAIL; then
  SMTP_HOST=mailpit; SMTP_PORT=1025; SMTP_USER=; SMTP_PASSWORD=; SMTP_FROM="noreply@${DOMAIN}"
else
  ask SMTP_HOST "SMTP host"
  ask SMTP_PORT "SMTP port" 587
  ask SMTP_USER "SMTP użytkownik" ""
  ask SMTP_PASSWORD "SMTP hasło" "" secret
  ask SMTP_FROM "Adres nadawcy" "noreply@${DOMAIN}"
fi
ask BACKUP_DISK_PATH "Ścieżka dysku zewnętrznego na backupy" "$($IS_ROOT && echo /mnt/backup || echo "${APP_DIR}/backups")"
ask BACKUP_S3_ENDPOINT "Backup off-site: endpoint S3 (puste = pomiń)" ""
if [ -n "$BACKUP_S3_ENDPOINT" ]; then
  ask BACKUP_S3_BUCKET "Bucket"
  ask AWS_ACCESS_KEY_ID "Klucz dostępu S3"
  ask AWS_SECRET_ACCESS_KEY "Sekret S3" "" secret
fi

# DNS ------------------------------------------------------------------------
server_ip=$(curl -fsS https://api.ipify.org || true)
dns_ip=$(getent hosts "$DOMAIN" | awk '{print $1; exit}' || true)
if [ -n "$server_ip" ] && [ "$server_ip" != "$dns_ip" ]; then
  log "UWAGA: ${DOMAIN} wskazuje na '${dns_ip:-brak}', serwer ma ${server_ip}. Let's Encrypt może się nie powieść."
fi

# 3. Sekrety i .env ----------------------------------------------------------
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then cp -a "$SRC_DIR/." "$APP_DIR/"; fi
[ -f "${DEPLOY_DIR}/.env" ] && die "${DEPLOY_DIR}/.env już istnieje. Użyj update.sh (nie nadpisuję sekretów)."

umask 077
cp "${DEPLOY_DIR}/.env.example" "${DEPLOY_DIR}/.env"
chmod 600 "${DEPLOY_DIR}/.env"
$IS_ROOT && chown root:root "${DEPLOY_DIR}/.env" || true

MASTER_KEY=$(gen_hex 32); RESTIC_PASSWORD=$(gen_pass)
env_set DOMAIN "$DOMAIN"; env_set ADMIN_EMAIL "$ADMIN_EMAIL"; env_set APP_URL "https://${DOMAIN}"
env_set APP_IMAGE "${APP_IMAGE:-obieg-rachunkow:local}"
env_set DEMO_MODE "$DEMO"
profiles=()
if $NO_AV; then env_set CLAMAV_ENABLED false; else env_set CLAMAV_ENABLED true; profiles+=(av); fi
[ "$PROXY" = caddy ] && profiles+=(caddy)
($DEMO || $TEST_MAIL) && profiles+=(mailpit)
env_set COMPOSE_PROFILES "$(IFS=,; echo "${profiles[*]:-}")"
env_set PROXY "$PROXY"; env_set APP_PORT "$APP_PORT"
if ($DEMO || $TEST_MAIL); then env_set SMTP_ALLOW_INSECURE true; fi
env_set POSTGRES_ADMIN_PASSWORD "$(gen_pass)"; env_set APP_DB_PASSWORD "$(gen_pass)"
env_set MIGRATOR_DB_PASSWORD "$(gen_pass)"
env_set MASTER_KEY "$MASTER_KEY"; env_set AUTH_SECRET "$(gen_hex 32)"; env_set RESTIC_PASSWORD "$RESTIC_PASSWORD"
env_set SMTP_HOST "$SMTP_HOST"; env_set SMTP_PORT "$SMTP_PORT"; env_set SMTP_USER "${SMTP_USER:-}"
env_set SMTP_PASSWORD "${SMTP_PASSWORD:-}"; env_set SMTP_FROM "$SMTP_FROM"
env_set BACKUP_DISK_PATH "$BACKUP_DISK_PATH"
if [ -n "$BACKUP_S3_ENDPOINT" ]; then
  env_set BACKUP_S3_ENDPOINT "$BACKUP_S3_ENDPOINT"; env_set BACKUP_S3_BUCKET "$BACKUP_S3_BUCKET"
  env_set AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"; env_set AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
fi
mkdir -p "$BACKUP_DISK_PATH"

# 4. Jednorazowe wyświetlenie kluczy -----------------------------------------
cat <<EOF

============================================================
 ZAPISZ TE KLUCZE TERAZ (menedżer haseł + drugie miejsce POZA serwerem).
 Bez nich nie odtworzysz danych. Nie zostaną wyświetlone ponownie.

   MASTER_KEY      = ${MASTER_KEY}
   RESTIC_PASSWORD = ${RESTIC_PASSWORD}
============================================================
EOF
if ! $NONINTERACTIVE; then
  while true; do read -r -p 'Wpisz "zapisałem", aby kontynuować: ' ok; [ "$ok" = "zapisałem" ] && break; done
fi

# 5. Utwardzenie hosta -------------------------------------------------------
if ! $SKIP_HARDENING; then
  log "Utwardzanie hosta (UFW, fail2ban, unattended-upgrades)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y ufw fail2ban unattended-upgrades >/dev/null
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban >/dev/null
  if [ -s /root/.ssh/authorized_keys ]; then
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
    systemctl reload ssh || true
  else
    log "UWAGA: brak kluczy SSH w /root/.ssh/authorized_keys, logowanie hasłem NIE zostało wyłączone."
  fi
fi

# 6. Start -------------------------------------------------------------------
log "Buduję i uruchamiam kontenery"
compose build
compose up -d
log "Czekam na /api/health"
for _ in $(seq 1 60); do
  compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 5
done || die "Aplikacja nie odpowiada. Sprawdź: docker compose logs app"

log "Pierwszy backup"
compose exec -T backup /usr/local/bin/run-backup.sh --tag initial || log "UWAGA: pierwszy backup nieudany"
if ! $DEMO; then
  log "Tworzę konto administratora (link aktywacyjny wypisany poniżej, 2FA wymuszone przy pierwszym logowaniu)"
  compose run --rm migrate npx tsx src/cli/create-admin.ts "$ADMIN_EMAIL" "Administrator" "$ORG_NAME"
fi
# TODO(E7): restore-test.sh po pierwszym backupie
$DEMO && log "TODO(E6): seed demo"

maintenance_log "install demo=${DEMO}"
cat <<EOF

Gotowe.
  URL:     https://${DOMAIN}
  Wersja:  $(env_get APP_IMAGE)
  Backup:  dysk ${BACKUP_DISK_PATH}${BACKUP_S3_ENDPOINT:+ + S3}
Następne kroki: otwórz link aktywacyjny admina, test SMTP, przechowanie kluczy poza serwerem.
EOF
