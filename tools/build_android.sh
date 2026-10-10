#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/android"
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
  elif [[ -x /usr/libexec/java_home ]]; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  fi
fi
if [[ ! -f signing.properties ]]; then
  echo "Missing apps/android/signing.properties. See apps/android/README.md for release signing setup." >&2
  exit 1
fi
if [[ $# -gt 0 && "${1:-}" != "--connected" ]]; then
  echo "Usage: $0 [--connected]" >&2
  exit 1
fi
# Keep emulator tests separate from memory-intensive R8 compilation.
# :domain（KMP 领域层模块，2026-10-10 起）的 jvmTest 承载领域层全部 171 项测试，
# 不点名就会漏跑——与 .github/workflows/android.yml 保持同一组任务。
./gradlew :app:testDebugUnitTest :domain:jvmTest :app:lintDebug
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
# python3（macOS/Linux）与 python（Windows Git Bash / 部分发行版）都可能不存在对方那个。
PYTHON="$(command -v python3 || command -v python)"
VERSION="$("$PYTHON" -c 'import json; print(json.load(open("app/build/outputs/apk/release/output-metadata.json"))["elements"][0]["versionName"])')"
OUT="$ROOT/dist/android"
mkdir -p "$OUT"
cp "$APK" "$OUT/KnowFlick-$VERSION.apk"
cp app/build/outputs/mapping/release/mapping.txt "$OUT/KnowFlick-$VERSION-mapping.txt"
cd "$OUT"
# shasum 是 macOS 自带；sha256sum 是 Linux/Windows Git Bash 的等价物。
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "KnowFlick-$VERSION.apk" > "KnowFlick-$VERSION.apk.sha256"
else
  shasum -a 256 "KnowFlick-$VERSION.apk" > "KnowFlick-$VERSION.apk.sha256"
fi
echo "APK: $OUT/KnowFlick-$VERSION.apk"
