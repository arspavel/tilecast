#!/usr/bin/env bash
# Saves the LSR signage database and media to backups/<date>/.
# Media is copied from the tilecast_data volume, so the archive can be large.
#
#   sudo ./backup.sh            database and media
#   sudo ./backup.sh --db-only  database only
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$DIR/backups/$STAMP"
mkdir -p "$TARGET"
chmod 700 "$DIR/backups"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' | gzip > "$TARGET/database.sql.gz"
gunzip -t "$TARGET/database.sql.gz"
printf 'База данных: %s\n' "$TARGET/database.sql.gz"

if [ "${1:-}" != "--db-only" ]; then
	docker compose exec -T server tar -C /data -czf - . > "$TARGET/data.tar.gz"
	printf 'Медиафайлы: %s\n' "$TARGET/data.tar.gz"
fi
cp .env "$TARGET/env.backup"
chmod 600 "$TARGET/env.backup"
