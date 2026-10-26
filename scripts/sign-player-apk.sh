#!/usr/bin/env bash
# Creates the signed update manifest and signature for an already built and
# signed Tilecast Player APK. The output is the same three files that a GitHub
# release contains, ready for upload in Studio (Player updates > Upload).
#
# Usage:
#   scripts/sign-player-apk.sh path/to/app-release.apk \
#     --key path/to/tilecast-update-private.pem \
#     [--public-key path/to/tilecast-update-public.pem] \
#     [--expected-cert <sha256 of the Android signing certificate>] \
#     [--channel stable|beta] [--notes "Release notes"] [--output DIR]
#
# Defaults come from TILECAST_UPDATE_MANIFEST_PRIVATE_KEY,
# TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE, TILECAST_ANDROID_CERT_SHA256,
# TILECAST_RELEASE_CHANNEL, and TILECAST_RELEASE_NOTES. The private key never
# leaves this machine; openssl asks for its passphrase if it has one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK=""
KEY="${TILECAST_UPDATE_MANIFEST_PRIVATE_KEY:-}"
PUBLIC_KEY="${TILECAST_UPDATE_MANIFEST_PUBLIC_KEY_FILE:-}"
EXPECTED_CERT="${TILECAST_ANDROID_CERT_SHA256:-}"
CHANNEL="${TILECAST_RELEASE_CHANNEL:-stable}"
NOTES="${TILECAST_RELEASE_NOTES:-}"
OUTPUT=""

fail() {
	printf 'Error: %s\n' "$1" >&2
	exit 1
}

while [ $# -gt 0 ]; do
	case "$1" in
		--key) KEY="${2:?--key needs a path}"; shift 2 ;;
		--public-key) PUBLIC_KEY="${2:?--public-key needs a path}"; shift 2 ;;
		--expected-cert) EXPECTED_CERT="${2:?--expected-cert needs a SHA-256 value}"; shift 2 ;;
		--channel) CHANNEL="${2:?--channel needs stable or beta}"; shift 2 ;;
		--notes) NOTES="${2:?--notes needs text}"; shift 2 ;;
		--output) OUTPUT="${2:?--output needs a directory}"; shift 2 ;;
		-h|--help) sed -n '2,17p' "$0"; exit 0 ;;
		-*) fail "unknown option $1" ;;
		*) [ -z "$APK" ] || fail "only one APK can be signed at a time"; APK="$1"; shift ;;
	esac
done

[ -n "$APK" ] || fail "pass the path to the signed APK (see --help)"
[ -f "$APK" ] || fail "APK not found: $APK"
[ -n "$KEY" ] || fail "pass --key or set TILECAST_UPDATE_MANIFEST_PRIVATE_KEY"
[ -f "$KEY" ] || fail "update manifest private key not found: $KEY"
[ "$CHANNEL" = stable ] || [ "$CHANNEL" = beta ] || fail "channel must be stable or beta"
command -v openssl >/dev/null || fail "openssl is required"
command -v java >/dev/null || fail "java is required to run apksigner"

# Locate the newest Android build tools.
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -n "${LOCALAPPDATA:-}" ]; then SDK="$LOCALAPPDATA/Android/Sdk"; fi
if [ -z "$SDK" ] && [ -d "$HOME/Android/Sdk" ]; then SDK="$HOME/Android/Sdk"; fi
[ -d "$SDK/build-tools" ] || fail "Android SDK build tools not found; set ANDROID_HOME"
BUILD_TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
APKSIGNER_JAR="$BUILD_TOOLS/lib/apksigner.jar"
AAPT="$BUILD_TOOLS/aapt"
[ -x "$AAPT" ] || AAPT="$BUILD_TOOLS/aapt.exe"
[ -f "$APKSIGNER_JAR" ] || fail "apksigner.jar not found in $BUILD_TOOLS"
[ -x "$AAPT" ] || fail "aapt not found in $BUILD_TOOLS"

# Capture complete command output before parsing it (see build-player-release.sh).
VERIFY_OUTPUT="$(java -jar "$APKSIGNER_JAR" verify --verbose --print-certs "$APK" 2>&1)" ||
	fail "the APK is not validly signed: $VERIFY_OUTPUT"
BADGING_OUTPUT="$("$AAPT" dump badging "$APK" | tr -d '\r')"
PACKAGE_METADATA="${BADGING_OUTPUT%%$'\n'*}"

APPLICATION_ID="$(printf '%s\n' "$PACKAGE_METADATA" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
VERSION_CODE="$(printf '%s\n' "$PACKAGE_METADATA" | sed -n "s/^package: name='[^']*' versionCode='\([^']*\)'.*/\1/p")"
VERSION_NAME="$(printf '%s\n' "$PACKAGE_METADATA" | sed -n "s/^package: name='[^']*' versionCode='[^']*' versionName='\([^']*\)'.*/\1/p")"
MINIMUM_SDK="$(printf '%s\n' "$BADGING_OUTPUT" | sed -n "s/^sdkVersion:'\([^']*\)'/\1/p")"
CERT_SHA="$(printf '%s\n' "$VERIFY_OUTPUT" | tr -d '\r' | bash "$ROOT/scripts/extract-apksigner-sha256.sh")"
APK_SIZE="$(wc -c < "$APK" | tr -d ' ')"
APK_SHA="$(openssl dgst -sha256 -r "$APK" | awk '{print $1}')"

[ "$APPLICATION_ID" = "org.tilecast.player" ] || fail "applicationId is ${APPLICATION_ID:-<empty>}, expected org.tilecast.player"
[[ "$VERSION_CODE" =~ ^[0-9]+$ ]] || fail "could not read versionCode"
[ -n "$VERSION_NAME" ] || fail "could not read versionName"
[[ "$MINIMUM_SDK" =~ ^[0-9]+$ ]] || fail "could not read the minimum SDK"
[[ "$CERT_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "could not read the APK signing certificate digest"
if [ -n "$EXPECTED_CERT" ]; then
	EXPECTED_CERT="$(printf '%s' "$EXPECTED_CERT" | tr -d ': ' | tr 'A-F' 'a-f')"
	[ "$CERT_SHA" = "$EXPECTED_CERT" ] ||
		fail "APK signing certificate $CERT_SHA does not match the expected $EXPECTED_CERT; installed players would refuse this update"
else
	printf 'Warning: no --expected-cert given; the certificate was not checked against your production key.\n' >&2
fi
[ -n "$NOTES" ] || NOTES="Tilecast Player for Android $VERSION_NAME"

json_string() {
	local value="$1" out="" char code i
	for ((i = 0; i < ${#value}; i++)); do
		char="${value:i:1}"
		case "$char" in
			'"') out+='\"' ;;
			'\') out+='\\' ;;
			$'\n') out+='\n' ;;
			$'\r') out+='\r' ;;
			$'\t') out+='\t' ;;
			*)
				printf -v code '%d' "'$char"
				if [ "$code" -ge 0 ] && [ "$code" -lt 32 ]; then printf -v char '\\u%04x' "$code"; fi
				out+="$char"
				;;
		esac
	done
	printf '"%s"' "$out"
}

[ -n "$OUTPUT" ] || OUTPUT="$ROOT/release-output/player-$VERSION_NAME"
mkdir -p "$OUTPUT"
MANIFEST="$OUTPUT/tilecast-player-update.json"
SIGNATURE="$OUTPUT/tilecast-player-update.json.sig"

cp "$APK" "$OUTPUT/tilecast-player.apk"
{
	printf '{\n'
	printf '  "schemaVersion": 1,\n'
	printf '  "product": "tilecast-player",\n'
	printf '  "applicationId": "org.tilecast.player",\n'
	printf '  "versionCode": %s,\n' "$VERSION_CODE"
	printf '  "versionName": %s,\n' "$(json_string "$VERSION_NAME")"
	printf '  "channel": "%s",\n' "$CHANNEL"
	printf '  "minimumSdk": %s,\n' "$MINIMUM_SDK"
	printf '  "apkAssetName": "tilecast-player.apk",\n'
	printf '  "apkSizeBytes": %s,\n' "$APK_SIZE"
	printf '  "apkSha256": "%s",\n' "$APK_SHA"
	printf '  "signingCertificateSha256": "%s",\n' "$CERT_SHA"
	printf '  "releaseNotes": %s\n' "$(json_string "$NOTES")"
	printf '}\n'
} > "$MANIFEST"

openssl pkeyutl -sign -rawin -inkey "$KEY" -in "$MANIFEST" | openssl base64 -A > "$SIGNATURE"

# Verify before anyone uploads the files: against the given public key when
# there is one, otherwise against the public half of the signing key.
RAW_SIGNATURE="$OUTPUT/.signature.bin"
trap 'rm -f "$RAW_SIGNATURE" "$OUTPUT/.derived-public.pem"' EXIT
openssl base64 -d -A -in "$SIGNATURE" > "$RAW_SIGNATURE"
if [ -z "$PUBLIC_KEY" ]; then
	PUBLIC_KEY="$OUTPUT/.derived-public.pem"
	openssl pkey -in "$KEY" -pubout -out "$PUBLIC_KEY"
fi
openssl pkeyutl -verify -rawin -pubin -inkey "$PUBLIC_KEY" -in "$MANIFEST" -sigfile "$RAW_SIGNATURE" >/dev/null ||
	fail "the new signature does not verify with $PUBLIC_KEY"

printf 'Signed Tilecast Player %s (versionCode %s, %s channel)\n' "$VERSION_NAME" "$VERSION_CODE" "$CHANNEL"
printf '  signing certificate %s\n' "$CERT_SHA"
printf 'Upload these three files in Studio (Player updates > Upload):\n'
printf '  %s\n' "$OUTPUT/tilecast-player.apk" "$MANIFEST" "$SIGNATURE"
