#!/usr/bin/env bash
# Restores a backup made by backup.sh. Current data is replaced.
#
#   sudo ./restore.sh backups/20261026-120000
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
SOURCE="${1:?Укажите папку резервной копии, например backups/20261026-120000}"
[ -f "$SOURCE/database.sql.gz" ] || { echo "Нет $SOURCE/database.sql.gz" >&2; exit 1; }

read -r -p "Текущие данные LSR signage будут заменены копией из $SOURCE. Продолжить? [y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || exit 1

docker compose stop server
gunzip -c "$SOURCE/database.sql.gz" | docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if [ -f "$SOURCE/data.tar.gz" ]; then
	docker compose run --rm --no-deps -T --entrypoint sh server -c 'find /data -mindepth 1 -delete && tar -C /data -xzf -' < "$SOURCE/data.tar.gz"
fi
docker compose start server
echo "Восстановление завершено."
