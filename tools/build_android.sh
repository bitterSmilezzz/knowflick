#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
  elif [[ -x /usr/libexec/java_home ]]; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  fi
fi
if [[ ! -f signing.properties ]]; then
  echo "Missing android/signing.properties. See android/README.md for release signing setup." >&2
  exit 1
fi
if [[ $# -gt 0 && "${1:-}" != "--connected" ]]; then
  echo "Usage: $0 [--connected]" >&2
  exit 1
fi
# Keep emulator tests separate from memory-intensive R8 compilation.
./gradlew :app:testDebugUnitTest :app:lintDebug
if [[ "${1:-}" == "--connected" ]]; then
  ./gradlew :app:connectedDebugAndroidTest
fi
./gradlew :app:assembleRelease
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" && -f local.properties ]]; then
  SDK="$(sed -n 's/^sdk.dir=//p' local.properties)"
fi
APK=app/build/outputs/apk/release/app-release.apk
"$SDK/build-tools/35.0.0/apksigner" verify --verbose --print-certs "$APK"
"$SDK/build-tools/35.0.0/zipalign" -c -P 16 4 "$APK"
VERSION="$(python3 -c 'import json; print(json.load(open("app/build/outputs/apk/release/output-metadata.json"))["elements"][0]["versionName"])')"
OUT="$ROOT/dist/android"
mkdir -p "$OUT"
cp "$APK" "$OUT/KnowFlick-$VERSION.apk"
cp app/build/outputs/mapping/release/mapping.txt "$OUT/KnowFlick-$VERSION-mapping.txt"
cd "$OUT"
shasum -a 256 "KnowFlick-$VERSION.apk" > "KnowFlick-$VERSION.apk.sha256"
echo "APK: $OUT/KnowFlick-$VERSION.apk"
