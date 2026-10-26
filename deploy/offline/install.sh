#!/usr/bin/env bash
# Installs or updates Tilecast from this offline bundle. Run it as root (or a
# user in the docker group) from the unpacked bundle directory:
#
#   sudo ./install.sh
#
# The first run creates .env with generated passwords. Later runs keep .env,
# back up the database, load the new images, and restart Tilecast.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

say() { printf '\n==> %s\n' "$1"; }
fail() { printf 'Ошибка: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker не установлен. Установите Docker Engine и плагин compose (см. INSTALL.md)."
docker compose version >/dev/null 2>&1 || fail "Нет плагина docker compose. Установите docker-compose-plugin."
docker info >/dev/null 2>&1 || fail "Docker недоступен. Запустите службу docker или выполните скрипт через sudo."
[ -f images/tilecast-images.tar.gz ] || fail "Не найден images/tilecast-images.tar.gz. Запускайте скрипт из распакованного комплекта."
[ -f VERSION ] || fail "Не найден файл VERSION."
IMAGE_TAG="$(tr -d ' \r\n' < VERSION)"

if [ -f SHA256SUMS ] && command -v sha256sum >/dev/null; then
	say "Проверка целостности файлов комплекта"
	sha256sum -c --quiet SHA256SUMS || fail "Файлы комплекта повреждены. Скопируйте архив ещё раз."
fi

random_secret() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; }
set_env() {
	local key="$1" value="$2"
	if grep -q "^${key}=" .env; then
		sed -i "s|^${key}=.*|${key}=${value}|" .env
	else
		printf '%s=%s\n' "$key" "$value" >> .env
	fi
}
env_value() { sed -n "s/^$1=//p" .env | tail -1; }

FIRST_RUN=false
if [ ! -f .env ]; then
	FIRST_RUN=true
	say "Создание .env"
	cp env.example .env
	chmod 600 .env
	set_env POSTGRES_PASSWORD "$(random_secret)"
	ADDRESS="$({ hostname -I 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' || true; } | awk 'NF {print $1; exit}')"
	PORT="$(env_value TILECAST_PORT)"
	set_env TILECAST_PUBLIC_URL "http://${ADDRESS:-127.0.0.1}:${PORT:-8080}"
fi
set_env TILECAST_IMAGE_TAG "$IMAGE_TAG"
[ -n "$(env_value POSTGRES_PASSWORD)" ] || fail "В .env не задан POSTGRES_PASSWORD."
[ -n "$(env_value TILECAST_PUBLIC_URL)" ] || fail "В .env не задан TILECAST_PUBLIC_URL."

if ! $FIRST_RUN && docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
	say "Резервная копия базы перед обновлением"
	./backup.sh
fi

say "Загрузка образов Docker (это займёт минуту-две)"
gunzip -c images/tilecast-images.tar.gz | docker load

say "Запуск Tilecast ${IMAGE_TAG}"
docker compose up -d --remove-orphans

say "Ожидание готовности сервера"
for _ in $(seq 1 60); do
	status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q server)" 2>/dev/null || true)"
	[ "$status" = healthy ] && break
	sleep 3
done
[ "${status:-}" = healthy ] || { docker compose logs --tail 50 server; fail "Сервер не перешёл в состояние healthy."; }

URL="$(env_value TILECAST_PUBLIC_URL)"
say "Готово"
printf 'Tilecast Studio: %s\n' "$URL"
if $FIRST_RUN; then
	printf 'Откройте адрес в браузере и создайте организацию и владельца.\n'
	printf 'Проверьте TILECAST_PUBLIC_URL в %s/.env: экраны подключаются именно по нему.\n' "$DIR"
fi
printf 'Плееры для экранов лежат в папке %s/players (см. INSTALL.md).\n' "$DIR"
