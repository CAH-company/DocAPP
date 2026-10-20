#!/bin/bash
# Generuje crontab z BACKUP_SCHEDULE i uruchamia supercronic.
set -euo pipefail
mkdir -p /cache/dump
echo "${BACKUP_SCHEDULE:-0 2 * * *} /usr/local/bin/run-backup.sh" > /tmp/crontab
exec supercronic /tmp/crontab
