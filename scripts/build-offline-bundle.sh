#!/usr/bin/env bash
# Builds an offline installation bundle for a server without Internet access:
# Docker images, compose file, install and backup scripts, and the latest
# player builds from this repository's GitHub releases.
#
#   scripts/build-offline-bundle.sh [--tag 2026.10.26] [--platform linux/amd64] [--no-players]
#
# Needs Docker with Internet access on the build machine. The result is
# release-output/tilecast-offline-<tag>.tar.gz.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(date +%Y.%m.%d)-$(git -C "$ROOT" rev-parse --short HEAD)"
PLATFORM="linux/amd64"
PLAYERS=true
REPOSITORY="${TILECAST_RELEASE_REPOSITORY:-arspavel/tilecast}"
POSTGRES_IMAGE="postgres:17-alpine"

while [ $# -gt 0 ]; do
	case "$1" in
		--tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
		--platform) PLATFORM="${2:?--platform needs a value}"; shift 2 ;;
		--no-players) PLAYERS=false; shift ;;
		-h|--help) sed -n '2,9p' "$0"; exit 0 ;;
		*) echo "Unknown option $1" >&2; exit 1 ;;
	esac
done
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Tag may contain only letters, digits, dot, dash, and underscore." >&2; exit 1; }

NAME="tilecast-offline-$TAG"
OUTPUT="$ROOT/release-output"
STAGE="$OUTPUT/$NAME"
rm -rf "$STAGE"
mkdir -p "$STAGE/images" "$STAGE/players"

echo "==> Building tilecast/server:$TAG for $PLATFORM"
docker build --platform "$PLATFORM" -f "$ROOT/deploy/docker/Dockerfile" -t "tilecast/server:$TAG" "$ROOT"
echo "==> Pulling $POSTGRES_IMAGE for $PLATFORM"
docker pull --platform "$PLATFORM" "$POSTGRES_IMAGE"
echo "==> Saving images"
docker save "tilecast/server:$TAG" "$POSTGRES_IMAGE" | gzip > "$STAGE/images/tilecast-images.tar.gz"

cp "$ROOT/deploy/offline/compose.yml" "$ROOT/deploy/offline/env.example" "$ROOT/deploy/offline/INSTALL.md" "$STAGE/"
for script in install.sh backup.sh restore.sh; do
	tr -d '\r' < "$ROOT/deploy/offline/$script" > "$STAGE/$script"
	chmod 755 "$STAGE/$script"
done
printf '%s\n' "$TAG" > "$STAGE/VERSION"

# Newest release whose tag starts with the prefix, from the public GitHub API.
latest_tag() {
	curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases?per_page=100" |
		grep -o '"tag_name": *"'"$1"'[0-9][^"]*"' | sed 's/.*"\([^"]*\)"$/\1/' |
		grep -v -i beta | sort -V | tail -1
}
fetch_assets() {
	local tag="$1" target="$2"; shift 2
	mkdir -p "$target"
	for asset in "$@"; do
		curl -fsSL -o "$target/$asset" "https://github.com/$REPOSITORY/releases/download/$tag/$asset"
	done
	printf '%s\n' "$tag" > "$target/RELEASE"
	echo "    $tag -> $target"
}

if $PLAYERS; then
	echo "==> Downloading players from $REPOSITORY"
	android="$(latest_tag player-v)"
	[ -n "$android" ] && fetch_assets "$android" "$STAGE/players/android" \
		tilecast-player.apk tilecast-player-update.json tilecast-player-update.json.sig
	webos="$(latest_tag player-webos-v)"
	[ -n "$webos" ] && fetch_assets "$webos" "$STAGE/players/webos" "org.tilecast.player.webos_${webos#player-webos-v}_all.ipk"
	windows="$(latest_tag player-windows-v)"
	if [ -n "$windows" ]; then
		version="${windows#player-windows-v}"
		fetch_assets "$windows" "$STAGE/players/windows" "tilecast-player-windows-$version-x64.exe" ||
			echo "    Windows player was not downloaded; add it to players/windows by hand." >&2
	fi
fi

echo "==> Writing checksums"
(cd "$STAGE" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | xargs sha256sum > SHA256SUMS)

echo "==> Packing"
tar -C "$OUTPUT" -czf "$OUTPUT/$NAME.tar.gz" "$NAME"
rm -rf "$STAGE"
ls -lh "$OUTPUT/$NAME.tar.gz"
echo "Copy $NAME.tar.gz to the server, unpack it, and run sudo ./install.sh (see INSTALL.md)."
